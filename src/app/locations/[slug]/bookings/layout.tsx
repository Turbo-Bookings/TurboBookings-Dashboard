import type { ReactNode } from "react";
import { BookingsSubNav } from "@/components/BookingsSubNav";

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function BookingsLayout({ children, params }: Props) {
  const { slug } = await params;
  return (
    <div>
      <BookingsSubNav slug={slug} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
