import { randomUUID } from 'node:crypto'
export function createUserMessage(value) { return Object.freeze({ id: randomUUID(), role: 'user', time: Date.now(), ...value }) }
export function defineTool(value) { return value }
