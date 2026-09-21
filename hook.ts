import { useState, useEffect, useRef } from "react";

export const useImageHeightOnLoad = (maxHeight?: number, minHeight?: number) => {
  const [height, setHeight] = useState<number | "auto">("auto"); // 初始给 auto，让图片自然撑开
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 图片加载完成时，获取真实宽高比
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setAspectRatio(img.naturalWidth / img.naturalHeight);
  };

  // 监听容器宽度变化
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !aspectRatio) return;

    const updateHeight = (width: number) => {
      let h = width / aspectRatio;
      if (maxHeight && h > maxHeight) h = maxHeight;
      if (minHeight && h < minHeight) h = minHeight;
      setHeight(Math.floor(h));
    };

    updateHeight(element.offsetWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        updateHeight(entry.contentRect.width);
      }
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [aspectRatio, maxHeight, minHeight]);

  return { containerRef, height, handleImageLoad };
};
