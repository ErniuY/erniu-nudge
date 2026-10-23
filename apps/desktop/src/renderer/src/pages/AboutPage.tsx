import pkg from '../../../../package.json';

const PROJECT_URL = 'https://github.com/ErniuY/erniu-nudge';

export default function AboutPage({
  onOpenProject,
  onOpenDataDir,
}: {
  onOpenProject: () => void;
  onOpenDataDir: () => void;
}) {
  return (
    <div className="page about">
      <header className="page-head">
        <div>
          <h1>关于</h1>
          <p className="muted">一个安静提醒你起身、喝水、按时吃饭的小工具。</p>
        </div>
      </header>

      <section className="panel">
        <h2>这个应用</h2>
        <p className="muted small">
          NUDGE 是一个 Windows 桌面提醒器。它按「有效连续使用时长」判断久坐，
          也支持你自己添加喝水、护眼、吃药、番茄钟等任意提醒，并自定义图标与触发规则。
        </p>
        <p className="muted small">
          所有数据都保存在本机，不需要账号，也不会上传。桌面外壳使用 Tauri 2 + Rust，
          提醒逻辑用纯 TypeScript 编写，因此占用很小，也方便将来复用到手机端。
        </p>
      </section>

      <section className="panel">
        <h2>版本信息</h2>
        <div className="about-list">
          <div className="about-row"><span>版本</span><b>{pkg.version}</b></div>
          <div className="about-row"><span>运行平台</span><b>Windows · Tauri 2</b></div>
          <div className="about-row"><span>数据位置</span><b>本机</b></div>
        </div>
      </section>

      <section className="panel">
        <h2>项目地址</h2>
        <p className="about-link">{PROJECT_URL}</p>
        <div className="data-actions">
          <button type="button" className="btn" onClick={onOpenProject}>
            打开 GitHub
          </button>
          <button type="button" className="btn ghost" onClick={onOpenDataDir}>
            打开数据文件夹
          </button>
        </div>
      </section>
    </div>
  );
}
