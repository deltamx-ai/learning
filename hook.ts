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

  // 1. 获取图片真实比例（避免外部传错）
  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      // 如果外部传的宽高不准，这里可以强制覆盖逻辑（这里假设外部传的是对的，直接用）
      console.log("原图真实尺寸:", img.naturalWidth, img.naturalHeight);
    };
  }, [imageUrl]);

  // 2. 监听容器宽度，动态计算高度和 Top
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateLayout = (containerWidth: number) => {
      // 根据设计稿宽度和原图比例，计算当前应该显示的高度
      // 注意：这里使用设计稿的宽高比来保证视觉与设计稿一致
      let targetHeight = (containerWidth / designWidth) * designHeight;

      // 应用最小高度限制（如果屏幕非常小）
      if (targetHeight < minHeight) {
        targetHeight = minHeight;
      }

      // 核心：根据高度的变化比例，同步计算 Top 的缩放
      const scale = targetHeight / designHeight;
      const targetTop = designTop * scale;

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
  }, [designWidth, designHeight, designTop, minHeight]);

  return { containerRef, ...layout };
};
