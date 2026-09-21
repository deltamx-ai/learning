import { useState, useEffect, useRef } from "react";

interface UseImageHeightOptions {
  originalWidth: number;
  originalHeight: number;
  maxHeight?: number; // 可选：限制最大高度，防止在大屏上无限变大
  minHeight?: number; // 可选：限制最小高度
}

export const useImageHeight = ({
  originalWidth,
  originalHeight,
  maxHeight,
  minHeight,
}: UseImageHeightOptions) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // 计算宽高比
    const aspectRatio = originalWidth / originalHeight;

    const updateHeight = (width: number) => {
      // 核心公式：高度 = 宽度 / 宽高比
      let calculatedHeight = width / aspectRatio;

      // 应用最大最小高度限制（如果有）
      if (maxHeight && calculatedHeight > maxHeight) {
        calculatedHeight = maxHeight;
      }
      if (minHeight && calculatedHeight < minHeight) {
        calculatedHeight = minHeight;
      }

      setHeight(Math.floor(calculatedHeight)); // 取整避免亚像素渲染问题
    };

    // 初始化计算
    updateHeight(element.offsetWidth);

    // 使用 ResizeObserver 监听容器宽度变化
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // 获取容器的实际宽度（不包含 padding）
        const width = entry.contentRect.width;
        updateHeight(width);
      }
    });

    resizeObserver.observe(element);

    // 清理监听
    return () => {
      resizeObserver.disconnect();
    };
  }, [originalWidth, originalHeight, maxHeight, minHeight]);

  return { containerRef, height };
};
