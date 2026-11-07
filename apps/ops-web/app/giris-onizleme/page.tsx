import type { Metadata } from "next";
import PhoneLoginPreview from "./phone-login-preview";

export const metadata: Metadata = {
  title: "Telefonla giriş önizlemesi | Flixify Pro",
  robots: { index: false, follow: false }
};

export default function PhoneLoginPreviewPage() {
  return <PhoneLoginPreview/>;
}
