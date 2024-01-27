import { Logger } from "../utils/Logger"
import { FileData, FileDataResponse, MemoryHelper } from "./memory"
import { Connection } from "./connection"
import { globalConfigs } from "../config"

export interface NodeLocation {
    address: string,
    port: number,
}

export interface NodeConfig {
    id: string,
    storageLocation: string,
    masterAddress: NodeLocation,
    global: typeof globalConfigs,
}

export type CallbackFunctionType = (err: Error | null, ok?: string) => void;

export interface MetaQueryResponse {
    files: {[key: string]: FileDataResponse}
}

export class Node {
    config: NodeConfig
    logger: Logger
    memoryHelper: MemoryHelper
    connection: Connection
    debugLastFiles: string | null = null

    constructor(config: NodeConfig) {
        this.config = config

        this.logger = new Logger(this.config.id)

        this.memoryHelper = new MemoryHelper(this.config.storageLocation, this.logger)
        this.connection = new Connection(this.config.masterAddress, this.config, this.logger)
    }

    async init() {
        await this.memoryHelper.init()
        await this.connection.init({
            add: this.callbackAdd.bind(this),
            delete: this.callbackDelete.bind(this),
            update: this.callbackUpdate.bind(this),
            metaQuery: this.callbackMetaQuery.bind(this),
            fileQuery: this.callbackFileQuery.bind(this),
        })

        await this.setNodeTasks()
        await this.pingTask()
    }

    async setNodeTasks() {
        setInterval(() => this.pingTask(), this.config.global.pingInterval)
        setInterval(() => this.hashCheckTask(), this.config.global.nodeHashCheckInterval)

    }

    async pingTask() {
        this.connection.ping({
            id: this.config.id,
            fileCount: await this.memoryHelper.getFileCount(),
            fileHash: 0,
        })
    }

    async hashCheckTask() {
        this.memoryHelper.hashCheckTask()
    }

    async callbackAdd(fileData: FileData, callback: CallbackFunctionType) {
        this.logger.log(`Received ADD request for file with name ${fileData.meta.name}.`, 'info')
        try {
            await this.memoryHelper.addFile(fileData)
            this.logger.log(`Done ADD request for file with name ${fileData.meta.name}.`, 'info')

            if(callback) callback(null, "ok")
        }
        catch(e) {
            this.logger.log(`Error doing ADD for file with name ${fileData.meta.name}: ${e.message}.`, 'error')
            if(callback) callback(e.message)
        }
    }

    async callbackDelete(fileData: FileData, callback: CallbackFunctionType) {
        this.logger.log(`Received DELETE request for file ${fileData.id}.`, 'info')
        try {
            await this.memoryHelper.deleteFile(fileData)
            this.logger.log(`Done DELETE request for file ${fileData.id}.`, 'info')

            if(callback) callback(null, "ok")
        }
        catch(e) {
            this.logger.log(`Error doing DELETE for file ${fileData.id}: ${e.message}.`, 'error')
            if(callback) callback(e.message)
        }
    }

    async callbackUpdate(fileData: FileData, callback: CallbackFunctionType) {
        this.logger.log(`Received UPDATE request for file ${fileData.id}.`, 'info')
        try {
            await this.memoryHelper.updateFile(fileData)
            this.logger.log(`Done UPDATE request for file ${fileData.id}.`, 'info')
            if(callback) callback(null, "ok")
        }
        catch(e) {
            this.logger.log(`Error doing UPDATE for file ${fileData.id}: ${e.message}.`, 'error')
            if(callback) callback(e.message)
        }
    }

    async callbackMetaQuery(callback: CallbackFunctionType) {
        try {
            let files = await this.memoryHelper.getFileMeta()
            if(callback) callback(null, JSON.stringify({ files: files }))
        }
        catch(e) {
            if(callback) callback(e.message)
        }

    }

    async callbackFileQuery(fileID: string, callback: CallbackFunctionType) {
        try {
            let fileData = await this.memoryHelper.getFile(fileID, true)
            if(callback) callback(null, JSON.stringify({ file: fileData }))
        }
        catch(e) {
            if(callback) callback(e.message)
        }
    }




    run() {
        if(typeof process.env.GLOBAL_DEBUG !== 'undefined') {
            setInterval(() => {
                let newFiles = Object.keys(this.memoryHelper.getMemory().files).join(", ")
                if(newFiles == this.debugLastFiles) return

                console.log(`Running (${this.config.id}). Files: ${newFiles}`)
                this.debugLastFiles = newFiles
            }, 5000)
        }

    }
}