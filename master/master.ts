import express from "express"
import http from "http"

import { Server } from "socket.io"
import { Logger } from "../utils/Logger"

import { FileMesh } from "./file_mesh"
import { NodeMesh } from "./node_mesh"

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.json({limit: '500mb'}))

const meshCheckAliveInterval = 2.5 * 1000
const requestMetaInterval = 10 * 1000
const meshCorrectnessValidation = 10 * 1000

export class Master {
    masterPort: number
    logger: Logger

    nodeMesh: any
    fileMesh: any

    constructor(config) {
        this.masterPort = config.masterAddress.port

        this.logger = new Logger("MASTER")

        this.nodeMesh = new NodeMesh(config, this.logger)
        this.fileMesh = new FileMesh(config, this.logger)

        this.nodeMesh.giveFileMesh(this.fileMesh)
        this.fileMesh.giveNodeMesh(this.nodeMesh)

    }

    async init() {
        await this.initRoutes()
    }

    async run() {
        server.listen(this.masterPort, () => {
            this.logger.log('Listening on *:' + this.masterPort);
        })

        setInterval(() => this.nodeMesh.checkAlive(), meshCheckAliveInterval)
        setInterval(() => this.fileMesh.requestMeta(), requestMetaInterval)
        setInterval(() => this.fileMesh.validateCorrectness(), meshCorrectnessValidation)
    }

    async initRoutes() {
        app.get('/style.css', (req, res) => res.sendFile(__dirname + '/templates/style.css'))
        app.get('/main.js', (req, res) => res.sendFile(__dirname + '/templates/main.js'))
        app.get('/nodes.js', (req, res) => res.sendFile(__dirname + '/templates/nodes.js'))
        app.get('/', (req, res) => {
            res.sendFile(__dirname + '/templates/main.html');
        })
        app.get('/nodes', (req, res) => {
            res.sendFile(__dirname + '/templates/nodes.html');
        })

        app.get('/api/getFiles', async (req, res) => {
            res.json({files: this.fileMesh.getFileList()})
        })

        app.get('/api/getNodes', async (req, res) => {
            res.json({nodes: this.nodeMesh.getNodes()})
        })

        app.post('/api/add', async (req, res) => {
            let fileData = req.body

            if(!fileData.size) return res.json({error: 'Invalid size for file.'})
            if(!fileData.content) return res.json({error: 'Empty file?'})
            if(!fileData.name) return res.json({error: 'Invalid name for file.'})

            try {
                this.logger.log(`Received ADD request for file with name: ${fileData.name}`, 'info')
                let cmd_res = await this.nodeMesh.commandAdd(fileData)
                this.logger.log(`Successfully added file with name: ${fileData.name}`, 'info')

                try { await this.fileMesh.requestMeta() } catch(e) {}
                res.json({success: `Uploaded successfully to ${cmd_res.length} nodes.`})
            }
            catch(e) {
                res.json({error: e.message})
            }
        })

        app.post('/api/delete', async (req, res) => {
            let fileData = req.body

            if(!fileData.id) return res.json({error: 'Invalid file ID.'})

            try {
                this.logger.log(`Received DELETE request for file ${fileData.id}`, 'info')
                let cmd_res = await this.nodeMesh.commandDel(fileData)
                this.logger.log(`Successfully deleted ${fileData.id}`, 'info')

                try { await this.fileMesh.requestMeta() } catch(e) {}
                res.json({success: `Successfuly deleted file from ${cmd_res.length} nodes.`})
            }
            catch(e) {
                res.json({error: e.message})
            }
        })

        io.on('connection', (socket) => {
            let firstPing = true
            socket.on("ping", (conf) => {
                let nodeID = this.nodeMesh.nodePing(socket, conf)

                if(firstPing) {
                    firstPing = false
                    let nodeRef = this.nodeMesh.mesh[nodeID]
                    this.fileMesh.requestMetaNode(nodeRef, nodeID)
                }
            })

        })
    }
}