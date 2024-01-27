
const intToBuff = function(nr) {
    if(typeof nr !== 'number') nr = parseInt(nr)

    let nums: number[] = []
    while(nr) {
        nums.push(nr & 0xFF)
        nr >>= 8
    }

    return Buffer.from(nums)
}

export const uuidGen = function() {
    let time = Date.now().toString()
    let p1 = time.split('.')[0].substr(0, 8)
    let p2 = time.split('.')[0].substr(8)
    let p3 = Math.round(Math.random() * 1000000).toString()

    let theBuffer = Buffer.from([
        ...intToBuff(p3),
        ...intToBuff(p2),
        ...intToBuff(p1),
        intToBuff(p3)[0]
    ])

    return theBuffer.toString('base64').replace(/=|\/|\+/g, '0')
}

export const sleep = function(time) {
    return new Promise((resolve) => setTimeout(resolve, time))
}
