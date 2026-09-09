/**
 * 用户服务 - 故意包含多种问题
 * 问题：命名混乱、长函数、嵌套深、空catch、同步IO
 */

const fs = require('fs')

// 🚨 函数名缩写
function gU(id) {
  // 🚨 空 catch
  try {
    const data = fs.readFileSync('/etc/passwd')  // 🚨 同步IO + 硬编码路径
  } catch (_) {}  // 🚨 静默吞错
  return { id, name: 'user' }
}

// 🚨 函数名万能词 + 超长函数
function doEverything(input) {
  // 🚨 变量名单字母
  let a = 0
  let b = []
  let c = {}

  // 🚨 嵌套超过3层
  for (let i = 0; i < input.length; i++) {
    for (let j = 0; j < input[i].items.length; j++) {
      if (input[i].items[j].valid) {
        a += input[i].items[j].price
        if (a > 1000) {
          console.log('big')
          if (input[i].user) {
            input[i].user.notified = true
          }
        }
      }
    }
  }
  return { total: a, list: b, meta: c }
}

// 🚨 函数名通用词
function handle(obj) {
  let tmp = obj
  tmp.status = 'done'
  return tmp
}

module.exports = { gU, doEverything, handle }
