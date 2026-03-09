/**
 * Shim: next/image → stub
 *
 * timber.js does not implement an image optimization pipeline.
 * This shim exports a pass-through <img> component so libraries
 * that import next/image still render correctly.
 */

import type { ImgHTMLAttributes } from 'react';

export type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** next/image width — passed through as the HTML attribute */
  width?: number | string;
  /** next/image height — passed through as the HTML attribute */
  height?: number | string;
  /** next/image priority — ignored (no optimization pipeline) */
  priority?: boolean;
  /** next/image quality — ignored */
  quality?: number;
  /** next/image fill — ignored */
  fill?: boolean;
  /** next/image sizes — passed through */
  sizes?: string;
  /** next/image placeholder — ignored */
  placeholder?: 'blur' | 'empty';
  /** next/image blurDataURL — ignored */
  blurDataURL?: string;
};

/**
 * Pass-through image component.
 *
 * Renders a plain <img> tag, ignoring next/image-specific optimization
 * props (priority, quality, fill, placeholder, blurDataURL).
 */
export function Image({
  priority: _priority,
  quality: _quality,
  fill: _fill,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  ...rest
}: ImageProps) {
  return rest as unknown;
}

export default Image;
