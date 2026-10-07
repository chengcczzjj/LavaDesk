import { app } from 'electron'
import { join } from 'path'

const dataDir = app.getPath('userData')

/** 主记忆数据库路径 */
export const MEMORY_DB_PATH = join(dataDir, 'lavadesk-memory.db')

/** 私密记忆数据库路径（独立文件隔离） */
export const PRIVATE_DB_PATH = join(dataDir, 'lavadesk-private.db')

/** Agent 文件快照目录 */
export const CHECKPOINTS_DIR = join(dataDir, 'agent-checkpoints')

/** Agent 应用内回收区目录 */
export const AGENT_TRASH_DIR = join(dataDir, 'agent-trash')
