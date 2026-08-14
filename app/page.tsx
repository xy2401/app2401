import Link from "next/link";

export default function Home() {
  return <>
    <section className="landing-hero page-shell">
      <div className="eyebrow"><span />开放 JSON · 本地分析 · 无后台</div>
      <h1>看懂软件，<br />也看懂它从哪里来。</h1>
      <p>软件源地图把 Scoop、Chocolatey、Homebrew、Fish 和 TLDR 的公开元数据整理成同一套可下载协议。网站、PowerShell 与 Bash 使用相同快照，不需要检出整个项目。</p>
      <div className="landing-actions">
        <Link className="button landing-primary" href="/catalog">开始查软件 →</Link>
        <Link className="button" href="/sources">了解数据来源</Link>
      </div>
    </section>

    <section className="landing-flow page-shell" aria-label="数据流">
      <div><span>01</span><strong>公开来源</strong><p>包索引、Fish 官方补全与 TLDR 精选命令页等维护边界明确的数据。</p></div>
      <b>→</b>
      <div><span>02</span><strong>版本化元数据</strong><p>带哈希的索引与分片，可缓存、校验，也能按需同步。</p></div>
      <b>→</b>
      <div><span>03</span><strong>多种使用方式</strong><p>网页搜索、本机清单分析，以及后续独立运行的 PS1 和 Bash。</p></div>
    </section>

    <section className="landing-capabilities page-shell">
      <article><span className="section-kicker">SOFTWARE</span><h2>软件是什么</h2><p>查看用途、官网、源码、许可证、平台、架构和不同包管理器中的安装方式。</p><Link href="/catalog">进入软件目录 →</Link></article>
      <article><span className="section-kicker">LINUX PICKS</span><h2>发行版推荐什么</h2><p>先看 Ubuntu、Debian、Fedora、Rocky、Arch、Alpine 和 openSUSE 维护的软件集合、开发环境和元包，需要时再进入完整仓库。</p><Link href="/distributions">浏览发行版精选 →</Link></article>
      <article><span className="section-kicker">COMMANDS</span><h2>命令怎么用</h2><p>TLDR 提供多语言完整命令模板与解释，中文优先、缺译回退英文；Fish 补充可静态确认的命令路径。</p><Link href="/catalog?query=git">查看命令示例 →</Link></article>
      <article><span className="section-kicker">INVENTORY</span><h2>电脑装了什么</h2><p>把本机清单交给浏览器本地匹配。没有上传接口、账号、数据库或用户追踪。</p><Link href="/inventory">分析本机清单 →</Link></article>
    </section>

    <section className="landing-open page-shell">
      <div><span className="section-kicker">ONE DATASET</span><h2>同一份数据，网页和脚本都能用</h2></div>
      <p><code>current.json</code> 指向不可变快照；客户端读取 manifest 后，只同步需要的搜索索引、包管理器索引或详情分片。</p>
    </section>
  </>;
}
