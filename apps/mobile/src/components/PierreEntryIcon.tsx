import { Image, type ImageStyle, type StyleProp } from "react-native";

import { markdownFileIconSource } from "@t3tools/mobile-markdown-text/file-icons";
import {
  resolveMarkdownFileIcon,
  resolveMarkdownFolderIcon,
} from "@t3tools/mobile-markdown-text/links";

/**
 * File and folder art, matching the web client. Material Icon Theme bakes
 * color into the artwork, so these are rasterized bitmaps rather than tinted
 * symbols and folders get a real glyph instead of an SF Symbol.
 */
export function PierreEntryIcon(props: {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size?: number;
  readonly style?: StyleProp<ImageStyle>;
}) {
  const size = props.size ?? 16;
  const icon =
    props.kind === "directory"
      ? resolveMarkdownFolderIcon(props.path)
      : resolveMarkdownFileIcon(props.path);

  return (
    <Image
      source={markdownFileIconSource(icon)}
      resizeMode="contain"
      style={[{ width: size, height: size }, props.style]}
    />
  );
}
