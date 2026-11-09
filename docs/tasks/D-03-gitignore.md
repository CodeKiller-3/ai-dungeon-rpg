# D-03 工作区清洁（.gitignore 收口，1 文件）

- 卡片编号：D-03
- 目标：让 `git status --porcelain` 为空，消除每张卡都被同一批 untracked 干扰的问题。
- 改动范围：仅 `.gitignore`
- 加三行：
  `.screenshots/`
  `preflight/shots_resize/`
  `自检报告.md`
- 不许动：不删任何文件、不改任何已跟踪内容、不改 js / md。
- 断言：
  D3-1 `git status --porcelain` 为空（含 untracked）
  D3-2 上述三个路径在磁盘上仍存在（不删除，只忽略）
  D3-3 已跟踪的 `preflight/selfcheck/shots/*.png` 不被忽略（`git check-ignore` 应无输出）
- 完成定义：一个 commit `D-03 工作区清洁`，推送，`git status` 空。
- 取舍：`自检报告.md` 是已被 `对标自检报告.md` 取代的旧报告，忽略而非删除，保留可追溯。
