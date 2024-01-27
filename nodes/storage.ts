import { Logger } from "../utils/Logger"

import * as fs from "fs/promises";
import { crc32 } from "js-crc";


export class StorageHelper {
    fileStorage: string
    storageLocation: string
    logger: Logger

    constructor(storageLocation: string, logger: Logger) {
        this.storageLocation = storageLocation
        this.fileStorage = storageLocation + '/' + 'files/'

        this.logger = logger
    }

    async init() {
        await this.ensureDirs()
    }

    async ensureDirs() {
        await fs.mkdir(this.fileStorage, {recursive: true})
    }

    async getFile(fileID: string): Promise<string> {
        let filePath = this.fileStorage + '/' + fileID
        let rawFileData: Buffer

        try {
            rawFileData = await fs.readFile(filePath)
        }
        catch (e) {
            if (e.code === 'ENOENT') return btoa("")
            throw e
        }

        // return btoa(fileData)
        return rawFileData.toString('base64')
    }

    async getCRC(fileID: string): Promise<string> {
        let filePath = this.fileStorage + '/' + fileID

        try {
            var fileData = await fs.readFile(filePath)
        }
        catch (e) {
            if (e.code === 'ENOENT') return crc32("")
            throw e
        }

        return crc32(fileData)
    }

    async addFile(fileID: string, fileContentB64: string) {
        let filePath = this.fileStorage + '/' + fileID
        // let rawContent = atob(fileContentB64)
        let rawContent = Buffer.from(fileContentB64, 'base64')

        await fs.writeFile(filePath, rawContent)

        // return crc32(rawContent)
    }

    async updateFile(fileID: string, fileContentB64: string) {
        let filePath = this.fileStorage + '/' + fileID
        // let rawContent = atob(fileContentB64)
        let rawContent = Buffer.from(fileContentB64, 'base64')

        await fs.writeFile(filePath, rawContent)

        // return crc32(rawContent)
    }

    async deleteFile(fileID: string) {
        let filePath = this.fileStorage + '/' + fileID

        try {
            await fs.unlink(filePath)
        }
        catch (e) {
            if (e.code === 'ENOENT') return true
            throw e
        }
    }

}
