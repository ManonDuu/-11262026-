const [major, minor] = process.versions.node.split('.').map(Number)
if (!((major === 22 && minor >= 13) || major === 24 || major >= 26)) {
  console.error('请安装 Node.js 24 LTS（或受支持的 Node 22.13+ / 26+）。当前版本：' + process.versions.node)
  process.exit(1)
}
