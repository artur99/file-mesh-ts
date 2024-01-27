import { Logger } from "../utils/Logger"
import { StorageHelper } from "./storage";

import * as fs from "fs/promises";
import { crc32 } from "js-crc";

export interface FileData {
    id: string;
    version: number;
    data: string;
    meta: {
        name: string;
        size: number;
    };
}

export type FileStatus = "live" | "pending" | "deleted";

interface Memory {
    files: { [key: string]: FileDataInMemory; };
}

export interface FileDataInMemory {
    id: string;
    version: number;
    data?: string;
    meta: {
        name: string;
        size: number;
    };
    locked?: boolean;
    status: FileStatus;
    dateAdded: number;
    dateUpdated?: number;
    dateDeleted?: number;
    fileCRC?: string;
    metaCRC?: string;
}

export interface FileDataResponse extends FileDataInMemory {
    data?: string;
}


const isObjectMemory = (obj: any): obj is Memory => {
    return obj?.files && typeof obj.files === "object";
}

interface DeleteFileRequest extends FileData {
    force?: boolean;
}

export class MemoryHelper {
    private memoryFile: string
    private deletionTimeout = 48 * 60 * 60 * 1000 // 2 days
    private storage: StorageHelper
    private memory: Memory

    constructor(
        private readonly storageLocation: string,
        private readonly logger: Logger
    ) {
        this.storageLocation = storageLocation
        this.memoryFile = storageLocation + '/' + 'memory.json'

        this.memory = {files: {}}
        this.storage = new StorageHelper(storageLocation, logger)

    }

    async init() {
        await this.ensureDirs()
        await this.storage.init()

        // Load in-file memory
        await this.loadMemory()

        await this.hashCheckTask()

        // Initial commit
        await this.saveMemory()
    }

    async ensureDirs() {
        await fs.mkdir(this.storageLocation, {recursive: true})
    }

    async loadMemory() {
        try {
            var memory_data = await fs.readFile(this.memoryFile, "utf-8")
            var memory_parsed = JSON.parse(memory_data)

            if(isObjectMemory(memory_parsed)) {
                this.memory = memory_parsed
            }
            else {
                this.logger.log(`Invalid memory file: missing or invalid key: 'files'.`)
            }
        }
        catch (e) {
            if(e.code != 'ENOENT') {
                this.logger.log(`Failed reading/parsing memory file ${this.memoryFile}: ${e.message}`)
            }
            // File doesn't exist yet
            // Just continue
        }
    }

    async saveMemory() {
        const memoryJson = JSON.stringify(this.memory)

        try {
            await fs.writeFile(this.memoryFile, memoryJson, "utf-8")
        }
        catch (e) {
            throw new Error(`Failed writing memory file ${this.memoryFile}: ${e.message}.`)
        }
    }

    getMemory() {
        return this.memory
    }

    getFileCount() {
        return Object.keys(this.memory.files)
            .filter(f => this.memory.files[f].status != "deleted").length
    }

    async getFileMeta() {
        return this.memory.files
    }

    objectCRC(obj: Record<string, string | number | boolean>) {
        let out_str = Object.keys(obj)
            .sort()
            .map(k => `${k}:${obj[k]}`)
            .join('/')

        return crc32(out_str)
    }


    async hashCheckTask() {
        for(let fileID of Object.keys(this.memory.files)) {
            let file = this.memory.files[fileID]

            if(file.locked) continue

            if(file.status != "live") {
                if(file.status == "deleted" && (!file.dateDeleted || Date.now() - file.dateDeleted > this.deletionTimeout)) {
                    // Cleanup
                    delete this.memory.files[fileID]
                    return true
                }
            }

            let metaCRC = this.objectCRC(file.meta)
            if(metaCRC != file.metaCRC) {
                this.logger.log(`Corrupted metaCRC found for file ${fileID}. Old one was ${file.metaCRC}, updated to ${metaCRC}.`)
                file.metaCRC = metaCRC
            }

            let fileDataCRC = await this.storage.getCRC(fileID)
            if(fileDataCRC != file.fileCRC) {
                this.logger.log(`Corrupted file data CRC found for file ${fileID}. Old one was ${file.fileCRC}, updated to ${fileDataCRC}.`)
                file.fileCRC = fileDataCRC
            }
        }
        return true
    }


    async addFile(fileData: FileData) {
        let fileID = fileData.id
        let fileVersion = fileData.version
        let fileDataB64 = fileData.data
        let fileMeta = fileData.meta

        this.memory.files[fileID] = {
            id: fileID,
            version: fileVersion,
            meta: fileMeta,
            locked: true,
            status: "pending",

            dateAdded: Date.now(),
            dateUpdated: Date.now(),
        }

        await this.storage.addFile(fileID, fileDataB64)

        let fileDataCRC = await this.storage.getCRC(fileID)
        let metaCRC = this.objectCRC(fileMeta)
        this.memory.files[fileID].fileCRC = fileDataCRC
        this.memory.files[fileID].metaCRC = metaCRC

        let theFile = this.memory.files[fileID]
        this.logger.log(`Added file ${fileID} v${theFile.version} (${theFile.meta.name}).`)

        this.memory.files[fileID].status = "live"
        this.memory.files[fileID].locked = false

        this.saveMemory()
        return true
    }


    async updateFile(fileData: FileData) {
        let fileID = fileData.id
        let fileVersion = fileData.version
        let fileDataB64 = fileData.data
        let fileMeta = fileData.meta

        if(!this.memory.files[fileID]) {
            throw new Error(`This file doesn't exist.`)
        }

        this.memory.files[fileID].locked = true


        if(fileVersion) this.memory.files[fileID].version = fileVersion
        if(fileMeta) this.memory.files[fileID].meta = fileMeta

        this.memory.files[fileID].dateUpdated = Date.now()

        if(fileDataB64) {
            await this.storage.updateFile(fileID, fileDataB64)
        }

        let fileDataCRC = await this.storage.getCRC(fileID)
        let metaCRC = this.objectCRC(this.memory.files[fileID].meta)
        this.memory.files[fileID].fileCRC = fileDataCRC
        this.memory.files[fileID].metaCRC = metaCRC


        let theFile = this.memory.files[fileID]
        this.logger.log(`Updated file ${fileID} v${theFile.version} (${theFile.meta.name}).`)

        this.memory.files[fileID].locked = false

        this.saveMemory()
        return true
    }


    async deleteFile(fileData: DeleteFileRequest) {
        let fileID = fileData.id

        if(!this.memory.files[fileID]) {
            throw new Error(`This file doesn't exist.`)
        }

        if(fileData.force) {
            await this.storage.deleteFile(fileID)
            delete this.memory.files[fileID]

            this.saveMemory()
            return true
        }

        this.memory.files[fileID].locked = true

        this.memory.files[fileID].status = "deleted"
        this.memory.files[fileID].dateDeleted = Date.now()
        this.memory.files[fileID].version = fileData.version


        await this.storage.deleteFile(fileID)

        this.logger.log(`Deleted file ${fileID} (${this.memory.files[fileID].meta.name}).`)

        this.memory.files[fileID].locked = false


        this.saveMemory()
        return true
    }


    async getFile(fileID: string, getContent = false): Promise<FileDataResponse> {
        if(!this.memory.files[fileID]) {
            throw new Error(`This file doesn't exist.`)
        }

        let theFile = this.memory.files[fileID]
        this.logger.log(`File requested: ${fileID} v${theFile.version} (${theFile.meta.name}).`)

        let retFileData = {
            ...theFile
        }

        delete retFileData.locked

        if(getContent) {
            retFileData.data = await this.storage.getFile(fileID)
        }

        return retFileData
    }


}
