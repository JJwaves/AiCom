# B2B 网站设计 Skills

本仓库提供三个 Codex 设计技能，不包含上游执行脚本或新增网站依赖。

| 技能 | 仓库路径 | 用途 |
|---|---|---|
| brand-design-system | .agents/skills/brand-design-system | 品牌方向、设计 tokens、可复用 DESIGN.md |
| b2b-commerce-ui | .agents/skills/b2b-commerce-ui | 产品规格、定制和批发询价 UI |
| frontend-quality-review | .agents/skills/frontend-quality-review | 视觉、移动端、可访问性与询价交互检查 |

## 在本仓库使用

Codex 会发现 `.agents/skills/` 中的技能。可直接输入：

```text
$brand-design-system 先检查现有项目，再规划品牌视觉规范，暂不改网站。
$b2b-commerce-ui 规划外卖袋产品规格、定制选项和批发询价流程。
$frontend-quality-review 检查当前网站，只报告问题。
```

若本机已经安装同名个人技能，选择本仓库路径对应的版本即可，无需重复安装。保留现有个人技能，不自动覆盖。

设计模板位于 `.agents/skills/brand-design-system/assets/DESIGN.md`。它是待确认的起点，不会自动替换项目现有品牌或证明任何产品事实。

## 在另一项目或新电脑安装

AiCom 为私有仓库，须先让 GitHub 连接或本机 Git 凭据获得访问权限。向 Codex 发送：

```text
使用 $skill-installer 从 JJwaves/AiCom 的 main 分支安装：
.agents/skills/brand-design-system
.agents/skills/b2b-commerce-ui
.agents/skills/frontend-quality-review
安装到 ~/.agents/skills；先检查同名目录，不覆盖已有技能。
```

安装器等价参数：

```text
--repo JJwaves/AiCom --ref main --path .agents/skills/brand-design-system .agents/skills/b2b-commerce-ui .agents/skills/frontend-quality-review --dest ~/.agents/skills
```

上面的路径是参数说明，不是独立 shell 命令。若需要固定版本，可把 main 换为确认过的提交 SHA。更新 GitHub 不会自动更新其他项目或个人目录中的副本；同步前比较差异，保留本地修改。

## 参考来源与审查边界

参考 shadcn/ui、HyperUI、Awesome DESIGN.md 和人工筛选的 Taste/minimalist-ui 原则；固定来源提交和原始 MIT 通知见各技能 `references/sources.md` 与 `licenses/`。

Taste 仅采用经审阅的纯文档子集；不安装上游 scripts、hooks 或原版技能入口。取消强制图片/动画数量、自动下载及与已有品牌冲突的硬性风格要求。这不是上游全库的安全认证。daisyUI 与 Chakra UI 仅保留为备选，不安装。

本地已通过 Codex 自带 quick_validate.py，且 skills/list 实际识别三个技能并显示 enabled=true、无加载错误。此次发布只添加技能和说明，没有运行网站视觉或业务端到端测试。

Codex 官方格式与发现规范：https://learn.chatgpt.com/docs/build-skills
