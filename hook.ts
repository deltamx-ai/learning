import { useState, useEffect, useRef } from "react";

export const useAutoImageHeight = (imageUrl: string, minHeight = 200) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(minHeight);
  const [imgInfo, setImgInfo] = useState<{ ratio: number; naturalHeight: number } | null>(null);

  // 1. 获取图片真实比例和物理高度
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      setImgInfo({
        ratio: img.naturalWidth / img.naturalHeight,
        naturalHeight: img.naturalHeight,
      });
    };
  }, [imageUrl]);

  // 2. 监听容器宽度，动态计算高度
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !imgInfo) return;

    const updateHeight = (width: number) => {
      // 按比例算出高度
      let calculatedHeight = width / imgInfo.ratio;

      // 智能限制最大高度：不能超过原图物理高度，也不能超过屏幕高度的 80%
      const screenLimit = window.innerHeight * 0.8;
      const maxAllowedHeight = Math.min(imgInfo.naturalHeight, screenLimit);

      // 应用限制
      if (calculatedHeight > maxAllowedHeight) {
        calculatedHeight = maxAllowedHeight;
      }
      if (calculatedHeight < minHeight) {
        calculatedHeight = minHeight;
      }

      setHeight(Math.floor(calculatedHeight));
    };

    updateHeight(element.offsetWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        updateHeight(entry.contentRect.width);
      }
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [imgInfo, minHeight]);

  return { containerRef, height };
};
