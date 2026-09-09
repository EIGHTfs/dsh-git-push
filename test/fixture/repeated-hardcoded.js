/**
 * dsh-skip-sensitive dsh-git-push v1.58.0 重复硬编码检测测试样本：故意含重复路径/域名/状态/凭据样本，
 * 作为规则检出测试输入，豁免敏感内容扫描（styleRules 检出由测试脚本复制到临时 repo 完成）
 * ============================================================
 * 硬编码重复文本检测测试文件
 * 用于测试 audit-rules 中 security/no-repeated-hardcoded-literals 规则
 *
 * 用法：使用 code-quality.js 或自定义脚本扫描此文件
 * 预期：应检测出 8+ 处重复硬编码文本
 * ============================================================
 */

const fs = require('fs')
const path = require('path')

// ============================================================
// 一、重复路径（应报警）
// ============================================================

// 🚨 路径 '/var/log/app.log' 出现 4 次
function writeLog(message) {
  fs.appendFileSync('/var/log/app.log', message + '\n')
}

function readLog() {
  return fs.readFileSync('/var/log/app.log', 'utf-8')
}

function backupLog() {
  fs.copyFileSync('/var/log/app.log', '/var/log/app.log.bak')
}

function cleanLog() {
  if (fs.existsSync('/var/log/app.log')) {
    fs.unlinkSync('/var/log/app.log')
  }
}

// 🚨 路径 '/tmp/cache' 出现 3 次
function getCache(key) {
  const file = '/tmp/cache/' + key + '.json'
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  }
  return null
}

function setCache(key, value) {
  const dir = '/tmp/cache'
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync('/tmp/cache/' + key + '.json', JSON.stringify(value))
}

function clearCache() {
  const dir = '/tmp/cache'
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true })
  }
}

// ============================================================
// 二、重复域名/URL（应报警）
// ============================================================

// 🚨 域名 'https://api.example.com' 出现 4 次
function fetchUser(id) {
  return fetch('https://api.example.com/users/' + id)
}

function fetchOrder(id) {
  return fetch('https://api.example.com/orders/' + id)
}

function fetchProduct(id) {
  return fetch('https://api.example.com/products/' + id)
}

function fetchInvoice(id) {
  return fetch('https://api.example.com/invoices/' + id)
}

// ============================================================
// 三、重复状态字符串（应报警）
// ============================================================

// 🚨 字符串 'pending' 出现 4 次
function isPending(order) {
  return order.status === 'pending'
}

function processPendingOrders(orders) {
  return orders.filter(o => o.status === 'pending')
}

function countPending(orders) {
  return orders.filter(o => o.status === 'pending').length
}

function logPending(order) {
  if (order.status === 'pending') {
    console.log('[INFO] Order is pending: ' + order.id)
  }
}

// 🚨 字符串 'completed' 出现 3 次
function markComplete(order) {
  order.status = 'completed'
}

function isComplete(order) {
  return order.status === 'completed'
}

function archiveComplete(orders) {
  return orders.filter(o => o.status === 'completed')
}

// ============================================================
// 四、重复日志前缀（应报警）
// ============================================================

// 🚨 字符串 '[ERROR]' 出现 4 次
function logError(msg) {
  console.log('[ERROR] ' + msg)
}

function handleApiError(err) {
  console.log('[ERROR] API error: ' + err.message)
}

function handleDbError(err) {
  console.log('[ERROR] DB error: ' + err.message)
  fs.writeFileSync('/var/log/app.log', '[ERROR] ' + err.message + '\n')
}

function validateInput(data) {
  if (!data.name) {
    console.log('[ERROR] Name is required')
    return false
  }
  return true
}

// ============================================================
// 五、重复端口号（应报警）
// ============================================================

// 🚨 端口 8642 出现 3 次
const PORT1 = 8642  // 虽然这里是常量，但数值本身多次出现

function startServer() {
  app.listen(8642)
}

function getServerUrl() {
  return 'http://localhost:8642'
}

function healthCheck() {
  fetch('http://localhost:8642/health')
}

// ============================================================
// 六、重复用户名/Token（应报警）
// ============================================================

// 🚨 用户名 'admin' 出现 3 次
function isAdmin(user) {
  return user.name === 'admin'
}

function initDefaultUser() {
  const defaultUser = { name: 'admin', password: 'admin123' }  // 这里也出现了
  return defaultUser
}

function checkAdminPermission(req) {
  if (req.user === 'admin') {
    return true
  }
  return false
}

// 🚨 Token 片段 'Bearer' 出现 3 次
function extractToken(header) {
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7)
  }
  return null
}

function buildAuthHeader(token) {
  return 'Bearer ' + token
}

function validateAuth(req) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new Error('Invalid auth header')
  }
  return auth.slice(7)
}

// ============================================================
// 七、正常的常量（不应报警）
// ============================================================

// ✅ 以下内容即使多次出现也不应报警（白名单保护）

const TRUE = true   // true 是合法重复
const ZERO = 0      // 0 是合法重复
const ONE = 1       // 1 是合法重复
const EMPTY = ''    // 空字符串是合法重复

function testBoolean(flag) {
  if (flag === true) { console.log('true') }
  if (flag !== true) { console.log('not true') }
  if (flag || true) { console.log('or true') }
}

function testNumber(n) {
  if (n === 0) { console.log('zero') }
  if (n > 0) { console.log('positive') }
  if (n < 0) { console.log('negative') }
  const arr = [0, 0, 0]  // 数字 0 被白名单保护
}

// ============================================================
// 八、正确的写法（应作为修复参考）
// ============================================================

// ✅ 正确：路径提取为常量
const LOG_BASE_DIR = '/var/log'
const LOG_FILE = LOG_BASE_DIR + '/app.log'
const CACHE_DIR = '/tmp/cache'

function writeLogCorrect(msg) {
  fs.appendFileSync(LOG_FILE, msg + '\n')
}

function getCacheCorrect(key) {
  const file = CACHE_DIR + '/' + key + '.json'
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  }
  return null
}

// ✅ 正确：域名提取为常量
const API_BASE_URL = 'https://api.example.com'

function fetchUserCorrect(id) {
  return fetch(API_BASE_URL + '/users/' + id)
}

function fetchOrderCorrect(id) {
  return fetch(API_BASE_URL + '/orders/' + id)
}

// ✅ 正确：状态值提取为常量对象
const ORDER_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

function isPendingCorrect(order) {
  return order.status === ORDER_STATUS.PENDING
}

function markCompleteCorrect(order) {
  order.status = ORDER_STATUS.COMPLETED
}

// ✅ 正确：日志级别提取为常量
const LOG_LEVEL = {
  ERROR: '[ERROR]',
  WARN: '[WARN]',
  INFO: '[INFO]'
}

function logErrorCorrect(msg) {
  console.log(LOG_LEVEL.ERROR + ' ' + msg)
}

// ✅ 正确：端口号放在 config
const SERVER_CONFIG = {
  PORT: 8642
}

function startServerCorrect() {
  app.listen(SERVER_CONFIG.PORT)
}

module.exports = {
  // 坏例子（故意不规范）
  writeLog, readLog, backupLog, cleanLog,
  getCache, setCache, clearCache,
  fetchUser, fetchOrder, fetchProduct, fetchInvoice,
  isPending, processPendingOrders, countPending, logPending,
  markComplete, isComplete, archiveComplete,
  logError, handleApiError, handleDbError, validateInput,
  PORT1, startServer, getServerUrl, healthCheck,
  isAdmin, initDefaultUser, checkAdminPermission,
  extractToken, buildAuthHeader, validateAuth,
  // 好例子（修复参考）
  writeLogCorrect, getCacheCorrect,
  fetchUserCorrect, fetchOrderCorrect,
  isPendingCorrect, markCompleteCorrect,
  logErrorCorrect, startServerCorrect
}