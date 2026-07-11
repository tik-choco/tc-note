import type { Ref } from "preact";
import { isImeComposing } from "../lib/util";
import { useT } from "../hooks/useAppSettings";

// In-page title: a large heading-like input that lives at the top of the
// document body instead of a toolbar field.
export function PageTitle(props: {
  titleInputRef: Ref<HTMLInputElement>;
  title: string;
  onTitleChange: (title: string) => void;
  onEnter: () => void;
}) {
  const { titleInputRef, title, onTitleChange, onEnter } = props;
  const t = useT();
  return (
    <input
      ref={titleInputRef}
      class="page-title"
      value={title}
      onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        // Ignore the Enter that confirms an IME conversion — it belongs to the
        // composition, not to "move focus into the body".
        if (e.key === "Enter" && !isImeComposing(e)) {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder={t("pageTitle.placeholder")}
    />
  );
}
