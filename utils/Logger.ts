export class Logger {
    name: string

    constructor(name) {
        this.name = name
    }

    log(text: string, type = "info") {
        let date = (new Date()).toISOString().replace("T", " ").split(".")[0]
        type = type.toUpperCase()
        console.log(`[${this.name}] [${type}] [${date}] ${text}`)
    }
}
