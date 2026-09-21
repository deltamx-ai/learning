import { useState, useEffect, useRef } from "react";

interface UseDynamicBannerOptions {
  imageUrl: string;
  originalWidth: number; // 原图宽 (4095)
  originalHeight: number; // 原图高 (2894)
  designWidth: number; // 设计稿宽 (1345)
  designHeight: number; // 设计稿高 (946)
  designTop: number; // 设计稿 Top 偏移 (-357)
  minHeight?: number; // 最小高度限制
}

export const useDynamicBanner = ({
  imageUrl,
  originalWidth,
  originalHeight,
  designWidth,
  designHeight,
  designTop,
  minHeight = 200,
}: UseDynamicBannerOptions) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({
    height: designHeight,
    top: designTop,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateLayout = (containerWidth: number) => {
      // 1. 计算当前高度
      // 注意：这里严格使用原图比例(originalWidth / originalHeight)，
      // 避免因为设计稿比例(1345/946)和原图比例(4095/2894)不一致导致图片变形。
      const ratio = originalWidth / originalHeight;
      let targetHeight = containerWidth / ratio;

      // 应用最小高度限制
      if (targetHeight < minHeight) {
        targetHeight = minHeight;
      }

      // 2. 核心：按高度差计算 Top
      // 公式：Top = 设计稿Top + (设计稿高度 - 当前高度)
      // 推导：设计稿底部位置 = designTop + designHeight = -357 + 946 = 589
      // 当前 Top = 589 - targetHeight
      const targetTop = designTop + designHeight - targetHeight;

      setLayout({
        height: Math.floor(targetHeight),
        top: Math.floor(targetTop),
      });
    };

    // 初始化
    updateLayout(element.offsetWidth);

    // 监听容器宽度变化
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        updateLayout(entry.contentRect.width);
      }
    });

    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [originalWidth, originalHeight, designWidth, designHeight, designTop, minHeight]);

  return { containerRef, ...layout };
};
