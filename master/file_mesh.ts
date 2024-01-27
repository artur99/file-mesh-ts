import { FileDataResponse } from "../nodes/memory"
import { MetaQueryResponse } from "../nodes/node"
import { Logger } from "../utils/Logger"
import { NodeMesh } from "./node_mesh"

export interface FileListResponse {
    id: string;
    nodes: string[];
    name: string;
    info: FileDataResponse;
}

interface FileMeshData {
    nodes: {[key: string]: FileDataResponse};
    meta: {
        name: string;
        size: number;
    };
    locked?: boolean;
}

export class FileMesh {
    mesh: {[key: string]: FileMeshData}
    nodesData: {[key: string]: FileDataResponse}
    nodeMesh: NodeMesh
    logger: Logger

    constructor(config, logger: Logger) {
        this.nodesData = {}
        this.mesh = {}
        this.logger = logger
    }

    giveNodeMesh(nodeMesh: NodeMesh) {
        this.nodeMesh = nodeMesh
    }

    pushNodeData(nodeID: string, nodeFiles) {
        this.nodesData[nodeID] = nodeFiles
        this.rebuildMesh()
    }

    requestMetaNode(nodeRef, nodeID: string): Promise<true> {
        return new Promise((resolve, reject) => {
            nodeRef.socket.emit("MetaQuery", (err, data) => {
                if(err) return reject(new Error(`Error on MetaQuery: ${err}`))
                try {
                    let dataP = JSON.parse(data) as MetaQueryResponse
                    this.pushNodeData(nodeID, dataP.files)
                    resolve(true)
                }
                catch(e) {
                    reject(new Error(`Failed parsing JSON response: ${e.message}`))
                }
            })

            setTimeout(() => reject(new Error(`Timeout receiving from node ${nodeID}...`)), 4000)
        })
    }

    async requestMeta() {
        this.nodeMesh.checkAlive()
        let prom: Promise<true>[] = []

        for(let nodeID of Object.keys(this.nodeMesh.mesh)) {
            let node = this.nodeMesh.mesh[nodeID]
            if(!node.alive) {
                this.pushNodeData(nodeID, {})
                continue
            }

            prom.push(this.requestMetaNode(node, nodeID))
        }

        return await Promise
            .all(prom)
            .catch(e =>
                this.logger.log(`Error getting nodes' meta: ${e.message}.`, 'error')
            )
    }


    rebuildMesh() {
        this.mesh = {}
        for(let nodeID of Object.keys(this.nodesData)) {
            if(!this.nodesData[nodeID]) continue

            for(let file of Object.keys(this.nodesData[nodeID])) {
                if(!this.mesh[file]) {
                    this.mesh[file] = {
                        nodes: {},
                        meta: this.nodesData[nodeID][file].meta
                    }
                }
                this.mesh[file].nodes[nodeID] = this.nodesData[nodeID][file]
            }
        }
    }

    getFileList(): FileListResponse[] {
        let files: FileListResponse[] = []

        for(let fileID of Object.keys(this.mesh)) {
            let file = this.mesh[fileID]
            let firstNode = file.nodes[Object.keys(file.nodes)[0]]

            if(firstNode.status !== 'live' || firstNode.dateDeleted) continue

            files.push({
                id: fileID,
                nodes: Object.keys(file.nodes),
                name: file.meta.name,
                info: firstNode
            })
        }

        return files
    }


    metadataMatchProblem(fileID: string) {
        let file = this.mesh[fileID]
        let nodes = Object.keys(file.nodes)
        let firstNode = file.nodes[nodes[0]]

        let fileCRC = firstNode.fileCRC
        let metaCRC = firstNode.metaCRC
        let version = firstNode.version || 0

        for(let node of nodes.slice(1)) {
            if((file.nodes[node].version || 0) != version) return "version"
            if(file.nodes[node].metaCRC != metaCRC) return "metacrc"
            if(file.nodes[node].fileCRC != fileCRC) return "filecrc"
        }

        return null
    }


    async validateCorrectness() {
        let updates = 0

        for(let fileID of Object.keys(this.mesh)) {
            let file = this.mesh[fileID]
            let nodes = Object.keys(file.nodes)

            if(file.locked) continue
            file.locked = true

            let nodeAliveTimes = nodes.map(node => this.nodeMesh.mesh[node].lastStart)
                .sort().slice(0, 1)

            if(!nodeAliveTimes.length) continue

            // If some nodes didn't update the MetaQuery yet (timeout: 15s)
            let fileTooEarly = Date.now() - nodeAliveTimes[0] < 15 * 1000
            if(fileTooEarly && nodes.length < 3) continue


            let nodeCount = nodes.length

            if(nodeCount > 3) {
                this.logger.log(`File ${fileID} has more than 3 nodes (it has ${nodeCount}), removing one...`)
                await this.fixingProcedureDel(fileID)
                    .catch(e => this.logger.log(`Error fixing (del) for file ${fileID}: ${e.message}`, 'error'))
                this.logger.log(`Done fixing ${fileID}.`)

                updates++
                file.locked = false
                continue
            }

            if(nodeCount < 3) {
                this.logger.log(`File ${fileID} has only ${nodeCount} nodes, adding to new node...`)
                await this.fixingProcedureAdd(fileID)
                    .catch(e => this.logger.log(`Error fixing (add) for file ${fileID}: ${e.message}`, 'error'))
                this.logger.log(`Done fixing ${fileID}.`)

                updates++
                file.locked = false
                continue
            }

            let prob = this.metadataMatchProblem(fileID)
            if(prob) {
                this.logger.log(`File ${fileID} has a ${prob} mismatch in some nodes, fixing the bad ones...`)
                console.log("FILE DATA", this.mesh[fileID])
                let res = await this.fixingProcedureFix(fileID)
                    .catch(e => this.logger.log(`Error fixing mismatch (${prob}) add for file ${fileID}: ${e.message}`, 'error'))
                this.logger.log(`Done fixing ${fileID}: ${res}`)

                updates++
                file.locked = false
                continue
            }
        }

        if(updates) {
            this.logger.log(`Repaired ${updates} files. Correctness validation job done. Updating metadata...`)
            await this.requestMeta()
            this.logger.log(`Done updating metadata.`)
        }
    }

    async getFullFileData(fileID: string, nodeID_r?: string): Promise<FileDataResponse> {
        return new Promise((resolve, reject) => {
            let fileData = this.mesh[fileID]
            let fileNodes = Object.keys(fileData.nodes)
            let nodeID = nodeID_r || fileNodes[0]
            let firstNode = this.nodeMesh.mesh[nodeID]

            firstNode.socket.emit("FileQuery", fileID, (err, data) => {
                if(err) return reject(new Error(`Error on FileQuery: ${err}`))

                try {
                    const dataP = JSON.parse(data)
                    const file = dataP.file as FileDataResponse

                    resolve(file)
                }
                catch(e) {
                    reject(new Error(`Failed parsing JSON response for file data (${fileID}): ${e.message}`))
                }
            })
        })
    }

    fixingProcedureAdd(fileID) {
        return new Promise(async (resolve, reject) => {
            let fileData = this.mesh[fileID]
            let fileNodes = Object.keys(fileData.nodes)

            try {
                var completeFileData = await this.getFullFileData(fileID)
            }
            catch(e) {
                reject(new Error(`Failed getting file data for ${fileID}: ${e.message}`))
                return
            }


            let availableNodes = Object.keys(this.nodeMesh.mesh)
                .filter(node =>  this.nodeMesh.mesh[node].alive && !fileNodes.includes(node))
                .sort((n1, n2) => this.nodeMesh.mesh[n1].fileCount - this.nodeMesh.mesh[n2].fileCount)
                .slice(0, 1)


            if(availableNodes.length == 0) {
                reject(new Error(`No available nodes to store this file (${fileID})... Please upgrade.`))
                return
            }


            let firstAvailableNode = this.nodeMesh.mesh[availableNodes[0]]


            firstAvailableNode.socket.emit("ADD", {
                id: completeFileData.id,
                version: completeFileData.version,
                data: completeFileData.data,
                meta: completeFileData.meta
            }, (err, ok) => {
                if(err) return reject(new Error(`Failed adding file ${fileID} to node ${availableNodes[0]}: ${err}`))
                resolve(ok)
            })
            setTimeout(() => reject(new Error(`Operation timed out adding file ${fileID} to node ${availableNodes[0]}`)), 8 * 1000)
        })
    }

    fixingProcedureDel(fileID) {
        return new Promise(async (resolve, reject) => {
            let fileData = this.mesh[fileID]
            let fileNodes = Object.keys(fileData.nodes)


            let busiestNodes = fileNodes
                .sort((n1, n2) => this.nodeMesh.mesh[n2].fileCount - this.nodeMesh.mesh[n1].fileCount)
                .slice(0, 1)


            let nodeToDel = this.nodeMesh.mesh[busiestNodes[0]]

            nodeToDel.socket.emit("DELETE", {
                id: fileID,
                force: true
            }, (err, ok) => {
                if(err) return reject(new Error(`Failed removing file ${fileID} from node ${busiestNodes[0]}: ${err}`))
                resolve(ok)
            })
            setTimeout(() => reject(new Error(`Operation timed out deleting file ${fileID} from node ${busiestNodes[0]}`)), 4 * 1000)
        })
    }

    async fixingProcedureFix(fileID: string) {
        let file = this.mesh[fileID]
        let nodes = Object.keys(file.nodes)

        let correctNode: string | null = null
        let badNode: string | null = null
        let problem: 'version' | 'metacrc' | 'filecrc' | null = null

        // Version checks
        let node_versions = nodes.sort((a, b) => file.nodes[b].version || 0 - file.nodes[a].version || 0)

        if((file.nodes[node_versions[0]].version || 0) != (file.nodes[node_versions.slice(-1)[0]].version || 0)) {
            correctNode = node_versions[0]
            badNode = node_versions.slice(-1)[0]
            problem = 'version'
        }

        // File Metadata Checks
        if(correctNode === null) {
            let metaCRCs: string[] = nodes.map(n => file.nodes[n].metaCRC).filter((crc): crc is string => !!crc).sort()

            if(metaCRCs[0] != metaCRCs.slice(-1)[0]) {
                let freq: {[key: string]: number} = {}
                for(let mcrc of metaCRCs) freq[mcrc] = freq[mcrc] ? freq[mcrc] + 1 : 1

                let crcsByFreq = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(x => x[0])

                let correctCRC = crcsByFreq[0]
                let correctNodes = nodes.filter(n => file.nodes[n].metaCRC === correctCRC)
                let badNodes = nodes.filter(n => file.nodes[n].metaCRC !== correctCRC)

                correctNode = correctNodes[0]
                badNode = badNodes[0]
                problem = 'metacrc'
            }
        }

        // File Content Checks
        if(correctNode === null) {
            let fileCRCs = nodes.map(n => file.nodes[n].fileCRC).filter((crc): crc is string => !!crc).sort()

            if(fileCRCs[0] != fileCRCs.slice(-1)[0]) {
                let freq: {[key: string]: number} = {}
                for(let mcrc of fileCRCs) freq[mcrc] = freq[mcrc] ? freq[mcrc] + 1 : 1

                let crcsByFreq = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(x => x[0])

                let correctCRC = crcsByFreq[0]
                let correctNodes = nodes.filter(n => file.nodes[n].fileCRC === correctCRC)
                let badNodes = nodes.filter(n => file.nodes[n].fileCRC !== correctCRC)

                correctNode = correctNodes[0]
                badNode = badNodes[0]
                problem = 'filecrc'
            }
        }

        if(correctNode === null) {
            this.logger.log(`Warning... Found no problem for file ${fileID} while investigating...`, 'warn')
            return new Promise(resolve => resolve(true))
        }



        return new Promise(async (resolve, reject) => {
            try {
                var completeFileData = await this.getFullFileData(fileID, correctNode!)
            }
            catch(e) {
                reject(new Error(`Failed getting file data for ${fileID} to fix other nodes: ${e.message}`))
                return
            }

            let nodeToFix = this.nodeMesh.mesh[badNode!]
            let newData: any = {
                id: completeFileData.id,
                version: completeFileData.version,
                meta: completeFileData.meta,
                status: completeFileData.status || null,
                dateAdded: completeFileData.dateAdded || null,
                dateUpdated: completeFileData.dateUpdated || null,
                dateDeleted: completeFileData.dateDeleted || null,
            }

            if(problem != 'metacrc') {
                newData.data = completeFileData.data
            }

            nodeToFix.socket.emit("UPDATE", newData, (err, ok) => {
                if(err) return reject(new Error(`Failed fixing file ${fileID} in node ${badNode}: ${err}`))
                resolve(`Updated node ${badNode} with data from ${correctNode}.`)
            })
            setTimeout(() => reject(new Error(`Operation timed out fixing file ${fileID} in node ${badNode}`)), 4 * 1000)
        })
    }


}
