let counter = 0; // 用于区分同一毫秒内的多个ID

export function generateCounterBasedId() {
    const timestamp = Date.now(); // 当前时间戳
    counter++; // 每次调用增加计数器
    return `${timestamp}${counter}`;
}