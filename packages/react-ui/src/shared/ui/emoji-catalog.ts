/**
 * The curated avatar emoji catalog (the document avatar's picker grid): a
 * tidy set of single emoji with an accessible label each. The avatar is a
 * short string / a few emoji (the core's `meta.avatar`), so the catalog is
 * display-only (the pick stands the emoji itself; the label is the
 * accessible name and the e2e's pin).
 */
interface AvatarEmoji {
  emoji: string;
  label: string;
}

const AVATAR_EMOJI: readonly AvatarEmoji[] = [
  { emoji: "🦊", label: "Fox" },
  { emoji: "🐱", label: "Cat" },
  { emoji: "🐶", label: "Dog" },
  { emoji: "🐼", label: "Panda" },
  { emoji: "🦄", label: "Unicorn" },
  { emoji: "🐸", label: "Frog" },
  { emoji: "🦉", label: "Owl" },
  { emoji: "🐢", label: "Turtle" },
  { emoji: "🐝", label: "Bee" },
  { emoji: "🦋", label: "Butterfly" },
  { emoji: "🌞", label: "Sun" },
  { emoji: "🌙", label: "Moon" },
  { emoji: "⭐", label: "Star" },
  { emoji: "✨", label: "Sparkles" },
  { emoji: "🌈", label: "Rainbow" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "💎", label: "Gem" },
  { emoji: "⚡", label: "Bolt" },
  { emoji: "❤️", label: "Red heart" },
  { emoji: "💙", label: "Blue heart" },
  { emoji: "💚", label: "Green heart" },
  { emoji: "💛", label: "Yellow heart" },
  { emoji: "✏️", label: "Pencil" },
  { emoji: "📚", label: "Books" },
  { emoji: "🎯", label: "Target" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🎨", label: "Palette" },
  { emoji: "☕", label: "Coffee" },
  { emoji: "🍀", label: "Clover" },
  { emoji: "🏆", label: "Trophy" },
];

export { AVATAR_EMOJI };
export type { AvatarEmoji };
