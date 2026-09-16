import { useState, type ReactNode } from 'react';

// 带草稿态的文本 / 数字输入框。
//
// 直接给受控 input 传「解析后再格式化」出来的值是个经典陷阱：用户每敲一个字符，
// 值就被重新解析、清洗、回写，还没敲完的半截内容会被过滤掉，表现就是「打不进任何字」。
// 比如时间列表里敲个 0，它不满足 HH:mm 就被吞了，输入框又变回空。
//
// 所以这里把用户输入的原文留在本地草稿里，只把「能解析出有效值」的部分回写出去；
// 失焦时再把草稿对齐到已提交的值。
export default function DraftInput({
  committed,
  onCommit,
  type = 'text',
  placeholder,
  hint,
}: {
  // 已提交值的显示形式
  committed: string;
  // 只在解析出有效值时才调用，无效的半截输入不会回写
  onCommit: (raw: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  // 根据当前原文返回提示；返回 null 表示无需提示
  hint?: (raw: string) => ReactNode;
}) {
  const [text, setText] = useState(committed);
  const [syncedFrom, setSyncedFrom] = useState(committed);

  // 外部值变了（切换触发器类型、重新载入草稿、主进程回写配置）才同步；
  // 用户正在输入时 committed 通常不变，所以不会打断输入。
  if (committed !== syncedFrom) {
    setSyncedFrom(committed);
    setText(committed);
  }

  const hintNode = hint?.(text);

  return (
    <>
      <input
        type={type}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value); // 先原样显示，绝不吞掉用户的按键
          onCommit(event.target.value);
        }}
        onBlur={() => setText(committed)}
      />
      {hintNode}
    </>
  );
}
