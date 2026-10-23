import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  APP_DEFAULTS,
  type AppConfig,
  type ThemeSettings,
} from '@app/schema';

type Point = { x: number; y: number };
type DragLayer = 'text' | 'image' | 'actions';

interface DragState {
  layer: DragLayer;
  element: HTMLElement;
  rect: DOMRect;
  size: { width: number; height: number };
  startPointer: Point;
  startPosition: Point;
  latestPosition: Point;
}

function fitStyle(imageUrl: string, fit: ThemeSettings['overlayBackgroundFit']): CSSProperties {
  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: fit === 'stretch' ? '100% 100%' : 'contain',
    backgroundPosition:
      fit === 'left' ? 'left center' : fit === 'right' ? 'right center' : 'center',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** 拖动预览只需要卡片尺寸级别的分辨率，避免每帧合成数千万像素的原图。 */
function usePreviewImage(source: string | null): string | null {
  const [preview, setPreview] = useState(source);

  useEffect(() => {
    if (!source) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const maxEdge = 1000;
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      if (scale >= 1) {
        setPreview(source);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        setPreview(source);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        setPreview(canvas.toDataURL('image/webp', 0.88));
      } catch {
        setPreview(source);
      }
    };
    image.onerror = () => {
      if (!cancelled) setPreview(source);
    };
    image.src = source;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [source]);

  return preview;
}

export default function ThemePage({
  config,
  assetUrls,
  onPatchTheme,
  onPickAsset,
}: {
  config: AppConfig;
  assetUrls: Record<string, string>;
  onPatchTheme: (patch: Partial<ThemeSettings>) => void;
  onPickAsset: (kind: 'background') => Promise<string | null>;
}) {
  const theme = config.theme ?? APP_DEFAULTS.theme;
  const homeBackgroundUrl = theme.homeBackground ? assetUrls[theme.homeBackground] : null;
  const overlayBackgroundUrl = theme.overlayBackground
    ? assetUrls[theme.overlayBackground]
    : null;
  const homeBackgroundPreview = usePreviewImage(homeBackgroundUrl);
  const overlayBackgroundPreview = usePreviewImage(overlayBackgroundUrl);
  const isCharacter = theme.overlayImageMode === 'character';

  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [textPosition, setTextPosition] = useState(theme.overlayTextPosition);
  const [imagePosition, setImagePosition] = useState(theme.overlayImagePosition);
  const [actionsPosition, setActionsPosition] = useState(theme.overlayActionsPosition);
  const [dragging, setDragging] = useState<DragLayer | null>(null);

  useEffect(() => {
    setTextPosition(theme.overlayTextPosition);
  }, [theme.overlayTextPosition.x, theme.overlayTextPosition.y]);

  useEffect(() => {
    setImagePosition(theme.overlayImagePosition);
  }, [theme.overlayImagePosition.x, theme.overlayImagePosition.y]);

  useEffect(() => {
    setActionsPosition(theme.overlayActionsPosition);
  }, [theme.overlayActionsPosition.x, theme.overlayActionsPosition.y]);

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
      }
    },
    [],
  );

  const currentPosition = (layer: DragLayer): Point => {
    if (layer === 'text') return textPosition;
    if (layer === 'image') return imagePosition;
    return actionsPosition;
  };

  const updatePosition = (layer: DragLayer, point: Point) => {
    if (layer === 'text') setTextPosition(point);
    else if (layer === 'image') setImagePosition(point);
    else setActionsPosition(point);
  };

  const savePosition = (layer: DragLayer, point: Point) => {
    if (layer === 'text') onPatchTheme({ overlayTextPosition: point });
    else if (layer === 'image') onPatchTheme({ overlayImagePosition: point });
    else onPatchTheme({ overlayActionsPosition: point });
  };

  const clampPosition = (point: Point, drag: DragState): Point => {
    const margin = 6;
    const halfWidth = drag.size.width / 2 + margin;
    const halfHeight = drag.size.height / 2 + margin;
    const minX = (halfWidth / drag.rect.width) * 100;
    const maxX = 100 - minX;
    const minY = (halfHeight / drag.rect.height) * 100;
    const maxY = 100 - minY;

    // 图层比卡片还大时只能居中，避免出现 min > max 的无效范围。
    return {
      x: minX <= maxX ? clamp(point.x, minX, maxX) : 50,
      y: minY <= maxY ? clamp(point.y, minY, maxY) : 50,
    };
  };

  const calculateDragPosition = (
    drag: DragState,
    clientX: number,
    clientY: number,
  ): Point =>
    clampPosition({
      x:
        drag.startPosition.x +
        ((clientX - drag.startPointer.x) / drag.rect.width) * 100,
      y:
        drag.startPosition.y +
        ((clientY - drag.startPointer.y) / drag.rect.height) * 100,
    }, drag);

  const dragTransform = (layer: DragLayer, dx: number, dy: number): string => {
    const translate = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%)`;
    return layer === 'image'
      ? `${translate} scale(${theme.overlayImageScale})`
      : translate;
  };

  const paintDrag = (drag: DragState, point: Point) => {
    const dx = ((point.x - drag.startPosition.x) / 100) * drag.rect.width;
    const dy = ((point.y - drag.startPosition.y) / 100) * drag.rect.height;
    drag.element.style.transform = dragTransform(drag.layer, dx, dy);
  };

  const flushDrag = () => {
    dragFrameRef.current = null;
    const drag = dragRef.current;
    if (drag) paintDrag(drag, drag.latestPosition);
  };

  const startDrag = (layer: DragLayer, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (layer === 'image' && !isCharacter)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const preview = previewRef.current;
    if (!preview) return;
    const startPosition = currentPosition(layer);
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      layer,
      element: event.currentTarget,
      rect: preview.getBoundingClientRect(),
      size: { width: bounds.width, height: bounds.height },
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition,
      latestPosition: startPosition,
    };
    setDragging(layer);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.latestPosition = calculateDragPosition(drag, event.clientX, event.clientY);
    if (dragFrameRef.current === null) {
      dragFrameRef.current = requestAnimationFrame(flushDrag);
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const point =
      event.type === 'pointercancel'
        ? drag.latestPosition
        : calculateDragPosition(drag, event.clientX, event.clientY);
    drag.element.style.left = `${point.x}%`;
    drag.element.style.top = `${point.y}%`;
    drag.element.style.transform =
      drag.layer === 'image'
        ? `translate(-50%, -50%) scale(${theme.overlayImageScale})`
        : 'translate(-50%, -50%)';
    dragRef.current = null;
    setDragging(null);
    updatePosition(drag.layer, point);
    savePosition(drag.layer, point);
  };

  const changeImageMode = (mode: ThemeSettings['overlayImageMode']) => {
    const nextText =
      mode === 'character'
        ? { x: clamp(textPosition.x, 28, 40), y: textPosition.y }
        : { x: clamp(textPosition.x, 34, 66), y: textPosition.y };
    setTextPosition(nextText);
    onPatchTheme({
      overlayImageMode: mode,
      overlayTextPosition: nextText,
    });
  };

  const changeActionsDirection = (
    direction: ThemeSettings['overlayActionsDirection'],
  ) => {
    const nextPosition =
      direction === 'vertical'
        ? {
            x: clamp(actionsPosition.x, 24, 76),
            y: clamp(actionsPosition.y, 42, 58),
          }
        : {
            x: clamp(actionsPosition.x, 42, 58),
            y: clamp(actionsPosition.y, 62, 80),
          };
    setActionsPosition(nextPosition);
    onPatchTheme({
      overlayActionsDirection: direction,
      overlayActionsPosition: nextPosition,
    });
  };

  const resetLayout = () => {
    const nextText = { ...APP_DEFAULTS.theme.overlayTextPosition };
    const nextImage = { ...APP_DEFAULTS.theme.overlayImagePosition };
    const nextActions = { ...APP_DEFAULTS.theme.overlayActionsPosition };
    setTextPosition(nextText);
    setImagePosition(nextImage);
    setActionsPosition(nextActions);
    onPatchTheme({
      overlayTextPosition: nextText,
      overlayImagePosition: nextImage,
      overlayImageScale: APP_DEFAULTS.theme.overlayImageScale,
      overlayActionsPosition: nextActions,
      overlayActionsDirection: APP_DEFAULTS.theme.overlayActionsDirection,
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>主题</h1>
          <p className="muted">把人物、提示文字和操作按钮摆到你喜欢的位置。</p>
        </div>
      </header>

      <section className="panel">
        <h2>图片素材</h2>

        <div className="theme-grid">
          <div className="theme-card">
            <div
              className="theme-thumb"
              style={
                homeBackgroundPreview
                  ? { backgroundImage: `url("${homeBackgroundPreview}")` }
                  : undefined
              }
            >
              {!homeBackgroundPreview && <span>默认渐变</span>}
            </div>
            <div className="theme-info">
              <span className="field-label">首页背景图</span>
              <span className="field-hint">显示在「当前连续使用」区域</span>
              <div className="inline-row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    const ref = await onPickAsset('background');
                    if (ref) onPatchTheme({ homeBackground: ref });
                  }}
                >
                  选择图片
                </button>
                {theme.homeBackground && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => onPatchTheme({ homeBackground: null })}
                  >
                    清除
                  </button>
                )}
              </div>
              <label className="theme-card-slider">
                <span className="field-label">
                  背景淡化 {Math.round(theme.homeDim * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={theme.homeDim}
                  onChange={(event) =>
                    onPatchTheme({ homeDim: Number(event.target.value) })
                  }
                />
                <span className="field-hint">
                  数值越高，默认渐变或背景图越淡，文字越清楚。
                </span>
              </label>
            </div>
          </div>

          <div className="theme-card">
            <div
              className={`theme-thumb${isCharacter ? ' character' : ''}`}
              style={
                overlayBackgroundPreview && !isCharacter
                  ? fitStyle(overlayBackgroundPreview, theme.overlayBackgroundFit)
                  : undefined
              }
            >
              {overlayBackgroundPreview && isCharacter ? (
                <img src={overlayBackgroundPreview} alt="" />
              ) : (
                !overlayBackgroundUrl && <span>纯白卡片</span>
              )}
            </div>
            <div className="theme-info">
              <span className="field-label">提醒弹窗图片</span>
              <span className="field-hint">可用作整张背景，也可作为人物或插画</span>
              <div className="inline-row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    const ref = await onPickAsset('background');
                    if (ref) onPatchTheme({ overlayBackground: ref });
                  }}
                >
                  选择图片
                </button>
                {theme.overlayBackground && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() =>
                      onPatchTheme({
                        overlayBackground: null,
                        overlayCardTransparent: false,
                      })
                    }
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <span className="field-hint">
          {isCharacter
            ? '建议使用透明背景的 PNG 或 WebP。人物可以自由拖动和缩放，再把文字拖到人物旁边。'
            : '背景模式会保持图片与卡片的固定关系；不拉伸时，空白区域不会裁掉图片内容。'}
        </span>
      </section>

      <section className="panel">
        <h2>弹窗排版</h2>

        <section className="overlay-basis-row">
          <div className="overlay-basis-copy">
            <h3>图片基调</h3>
            <span>先决定图片如何参与布局</span>
          </div>
          <label className="field">
            <span className="field-label">弹窗图片用法</span>
            <select
              value={theme.overlayImageMode}
              onChange={(event) =>
                changeImageMode(
                  event.target.value as ThemeSettings['overlayImageMode'],
                )
              }
            >
              <option value="background">整张背景图</option>
              <option value="character">人物 / 插画</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">背景图显示方式</span>
            <select
              value={theme.overlayBackgroundFit}
              disabled={isCharacter || !overlayBackgroundUrl}
              onChange={(event) =>
                onPatchTheme({
                  overlayBackgroundFit: event.target
                    .value as ThemeSettings['overlayBackgroundFit'],
                })
              }
            >
              <option value="stretch">拉伸铺满</option>
              <option value="center">不拉伸 · 居中</option>
              <option value="left">不拉伸 · 靠左</option>
              <option value="right">不拉伸 · 靠右</option>
            </select>
          </label>
        </section>

        <div className="overlay-editor">
          <div className="overlay-editor-stage">
            <div className="overlay-editor-stage-head">
              <span className="overlay-editor-title">拖拽预览</span>
              <button type="button" className="text-btn" onClick={resetLayout}>
                恢复默认排版
              </button>
            </div>
            <div
              className={`overlay-preview${isCharacter ? ' character-mode' : ''}${
                theme.overlayCardTransparent ? ' transparent-card' : ''
              }`}
              ref={previewRef}
              style={
                overlayBackgroundPreview && !isCharacter
                  ? fitStyle(overlayBackgroundPreview, theme.overlayBackgroundFit)
                  : undefined
              }
            >
              {overlayBackgroundPreview && !isCharacter && (
                <span
                  className="overlay-preview-dim"
                  style={{ opacity: theme.overlayDim }}
                />
              )}
              {overlayBackgroundPreview && isCharacter && (
                <img
                  className={`overlay-preview-character${
                    dragging === 'image' ? ' dragging' : ''
                  }`}
                  src={overlayBackgroundPreview}
                  alt=""
                  draggable={false}
                  style={{
                    left: `${imagePosition.x}%`,
                    top: `${imagePosition.y}%`,
                    transform: `translate(-50%, -50%) scale(${theme.overlayImageScale})`,
                  }}
                  onPointerDown={(event) => startDrag('image', event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              )}
              <div
                className={`overlay-preview-text${
                  dragging === 'text' ? ' dragging' : ''
                }${isCharacter ? ' character-copy' : ''}`}
                style={{
                  left: `${textPosition.x}%`,
                  top: `${textPosition.y}%`,
                  textAlign: theme.overlayTextAlign,
                }}
                onPointerDown={(event) => startDrag('text', event)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <b>该站起来了</b>
                <span>你已经连续坐了 45 分钟</span>
              </div>
              <div
                className={`overlay-preview-actions ${
                  theme.overlayActionsDirection === 'vertical' ? 'vertical' : ''
                }${dragging === 'actions' ? ' dragging' : ''}`}
                style={{
                  left: `${actionsPosition.x}%`,
                  top: `${actionsPosition.y}%`,
                }}
                onPointerDown={(event) => startDrag('actions', event)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                aria-label="可拖动的操作按钮组"
              >
                <span />
                <span />
                <span />
              </div>
            </div>
            <span className="field-hint">
              {isCharacter
                ? '人物、文字和按钮都能拖动。靠近边缘时会保留安全距离，松手后自动保存。'
                : '文字和按钮组可以拖动；背景图请使用右侧显示方式调整。'}
            </span>
          </div>

          <div className="overlay-inspector">
            <section className="overlay-inspector-group">
              <div className="overlay-inspector-head">
                <h3>内容与按钮</h3>
                <span>调整文字和操作区</span>
              </div>
              <div className="overlay-inspector-grid">
                <label className="field">
                  <span className="field-label">文字对齐</span>
                  <select
                    value={theme.overlayTextAlign}
                    onChange={(event) =>
                      onPatchTheme({
                        overlayTextAlign: event.target
                          .value as ThemeSettings['overlayTextAlign'],
                      })
                    }
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">按钮排列</span>
                  <select
                    value={theme.overlayActionsDirection}
                    onChange={(event) =>
                      changeActionsDirection(
                        event.target
                          .value as ThemeSettings['overlayActionsDirection'],
                      )
                    }
                  >
                    <option value="horizontal">横排</option>
                    <option value="vertical">竖排</option>
                  </select>
                </label>
                {isCharacter && overlayBackgroundUrl && (
                  <label className="field full">
                    <span className="field-label">
                      人物大小 {Math.round(theme.overlayImageScale * 100)}%
                    </span>
                    <input
                      type="range"
                      min={0.4}
                      max={1.8}
                      step={0.05}
                      value={theme.overlayImageScale}
                      onChange={(event) =>
                        onPatchTheme({
                          overlayImageScale: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            </section>

            <section className="overlay-inspector-group">
              <div className="overlay-inspector-head">
                <h3>卡片外观</h3>
                <span>控制背景与底板</span>
              </div>
              <label className="field">
                <span className="field-label">
                  背景蒙版 {Math.round(theme.overlayDim * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={theme.overlayDim}
                  disabled={isCharacter || !overlayBackgroundUrl}
                  onChange={(event) =>
                    onPatchTheme({ overlayDim: Number(event.target.value) })
                  }
                />
              </label>
              {overlayBackgroundUrl && (
                <label className="chip-check theme-transparent-toggle">
                  <input
                    type="checkbox"
                    checked={theme.overlayCardTransparent}
                    onChange={(event) =>
                      onPatchTheme({
                        overlayCardTransparent: event.target.checked,
                      })
                    }
                  />
                  透明卡片
                </label>
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
