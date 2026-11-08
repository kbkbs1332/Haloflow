# 打包

## 用户脚本

没有构建步骤，`userscript/haloflow.user.js` 就是最终产物。改完直接装。

改了 `@version` 之后，Tampermonkey 会按 `@updateURL` 去检查更新；如果自己没有托管地址，把那两行删掉即可。

## 扩展 → CRX

Chrome 要求 CRX3 格式：`Cr24` + 版本号 + 头长度 + protobuf 头 + zip。

仓库自带脚本：

```bash
cd tools
python3 build_crx.py          # 正式版 → src/haloflow.crx
python3 build_crx.py --dev    # 开发者版 → src/haloflow-dev.crx（独立 key，可与正式版共存）
```

首次运行会自动用 `openssl` 生成 `haloflow_key.pem`（**别提交，已经在 .gitignore 里**）。
扩展 ID 由公钥 DER 的 SHA256 前 16 字节推出来，所以 key 不变 ID 就不变，更新时能覆盖安装。

## 不打包也行

`chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」 → 选 `extension/` 目录，改代码后点刷新即可。

## 版本号约定

`主.次.修`：

- 修 bug → `+0.0.1`
- 加功能 → `+0.1.0`
- 大改 → `+1.0.0`

扩展和用户脚本保持同一个号，方便对照。
