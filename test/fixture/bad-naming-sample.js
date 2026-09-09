/**
 * 这是一个故意充满“坏命名”的示例文件
 * 用于测试代码质量检查工具是否能检测出：
 *   - 函数名缩写/无意义
 *   - 变量名单字母/通用名
 *   - 魔数、长函数、无注释
 */

// ----- 1. 函数名问题 -----
function gU() {                     // 缩写，无法猜出含义
  return 42
}

function proc(d) {                  // 简称 + 参数名无意义
  let x = 0
  for (let i = 0; i < d.length; i++) {
    x += d[i]
  }
  return x
}

function doIt(a, b) {               // 万能动词 + 单字母参数
  return a + b
}

function handle(obj) {              // 万能动词，不知道处理什么
  obj.status = 'done'
  return obj
}

// ----- 2. 变量名问题 -----
function calculatePrice(base, tax) {
  let a = base * 1.2               // a 表示什么？
  let b = a + tax                  // b 表示什么？
  let c = b * 0.05                // c 表示什么？
  let flag = true                 // flag 表示什么条件？
  let data = { price: c }         // data 太泛
  return data
}

// ----- 3. 魔数与字符串散落 -----
function processOrder(status) {
  if (status === 1) {              // 1 是什么意思？
    console.log('pending')
  } else if (status === 2) {       // 2 是什么意思？
    console.log('processing')
  } else if (status === 3) {       // 3 是什么意思？
    console.log('done')
  }
}

// ----- 4. 长函数 + 多层嵌套（可读性灾难） -----
function doEverything(input) {
  let a = 0
  for (let i = 0; i < input.length; i++) {
    for (let j = 0; j < input[i].items.length; j++) {
      if (input[i].items[j].valid) {
        a += input[i].items[j].price
        if (a > 1000) {
          console.log('big')
        } else {
          console.log('small')
          if (input[i].user) {
            input[i].user.notified = true
          }
        }
      }
    }
  }
  return a
}

// ----- 5. 无注释的复杂逻辑 -----
function xyz(p, q) {
  let r = p.filter(t => t.status === 'active').map(t => t.id)
  let s = q.filter(t => r.includes(t.parentId)).map(t => t.name)
  return s.join(', ')
}

// ----- 导出（如果是模块） -----
module.exports = {
  gU,
  proc,
  doIt,
  handle,
  calculatePrice,
  processOrder,
  doEverything,
  xyz
}
