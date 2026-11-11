# 第三方组件与许可声明（THIRD-PARTY-NOTICES）

本项目为《人工智能基础》课程大作业，运行时**零构建、零 npm 依赖**。仓库内 `js/vendor/` 下的 3 个文件为第三方开源库的原始分发文件（未修改），各自保留其原始版权与许可要求；`assets/sprites/` 下的像素素材来源与许可见 [assets/sprites/LICENSE.md](assets/sprites/LICENSE.md)。

| 组件 | 版本 | 文件 | 许可 | 是否修改 |
|---|---|---|---|---|
| javascript-astar | 0.4.1 | `js/vendor/astar.js` | MIT | 否（原文件） |
| howler.js | 2.2.4 | `js/vendor/howler.min.js` | MIT | 否（原文件） |
| rot.js | 2.x（min 构建） | `js/vendor/rot.min.js` | **BSD-3-Clause** | 否（原文件） |

> 说明：`rot.min.js` 为压缩构建，文件头不含许可注释（上游构建时剥离）。按 BSD-3 要求，本项目在此**完整保留**其版权声明、三条款与免责声明。

---

## 1. javascript-astar 0.4.1 — MIT

来源：<https://github.com/bgrins/javascript-astar>

```
MIT License

Copyright (c) 2011 Brian Grinstead

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

该文件内含的二叉堆实现来自 Marijn Haverbeke（<http://eloquentjavascript.net/appendix2.html>），随上游一并按 MIT 分发。

## 2. howler.js 2.2.4 — MIT

来源：<https://github.com/goldfire/howler.js>

```
Copyright (c) 2013-2020 James Simpson and GoldFire Studios, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. rot.js — BSD-3-Clause（全文保留）

来源：<https://github.com/ondras/rot.js> · 使用范围：`js/systems/fov.js` 封装 `ROT.FOV.PreciseShadowcasting` 实现视野/记忆迷雾。

```
BSD 3-Clause License

Copyright (c) 2012-2016, Ondrej Zara
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 4. 本项目自身代码

`index.html`、`css/`、`js/`（除 `js/vendor/`）为自写实现，按仓库根目录 [LICENSE](LICENSE) 的 MIT 许可发布（© 2026 黄文博）。素材许可见 [assets/sprites/LICENSE.md](assets/sprites/LICENSE.md)。
