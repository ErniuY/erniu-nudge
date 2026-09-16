import { BuiltinIcon, BUILTIN_ICONS } from '../builtinIcons';

export default function IconPicker({
  value,
  color,
  assetUrls,
  onChange,
  onImport,
}: {
  value: string;
  color: string;
  assetUrls: Record<string, string>;
  onChange: (ref: string) => void;
  onImport: () => void;
}) {
  const userIcons = Object.keys(assetUrls);

  return (
    <div className="field">
      <span className="field-label">图标</span>
      <div className="icon-grid">
        {BUILTIN_ICONS.map((option) => {
          const ref = `builtin:${option.name}`;
          return (
            <button
              key={ref}
              type="button"
              title={option.label}
              className={`icon-cell${value === ref ? ' selected' : ''}`}
              onClick={() => onChange(ref)}
            >
              <BuiltinIcon name={option.name} size={22} color={value === ref ? color : '#5b6478'} />
            </button>
          );
        })}

        {userIcons.map((ref) => (
          <button
            key={ref}
            type="button"
            title="自定义图标"
            className={`icon-cell${value === ref ? ' selected' : ''}`}
            onClick={() => onChange(ref)}
          >
            <img src={assetUrls[ref]} alt="" width={22} height={22} />
          </button>
        ))}

        <button type="button" className="icon-cell add" title="导入图片" onClick={onImport}>
          ＋
        </button>
      </div>
      <span className="field-hint">
        支持 PNG / JPG / SVG，不超过 1 MB。
      </span>
    </div>
  );
}
