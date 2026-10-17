import { CheckIcon, LightbulbIcon } from "@/components/ui/icons";
import { Card } from "@/components/ui/primitives";

/** The reference's "tips for adding a product" side card — plain guidance, no data. */
export function TipsCard({ title, tips }: { title: string; tips: string[] }) {
  return (
    <aside aria-labelledby="product-tips-title" data-testid="product-tips">
      <Card pad="sm" className="bg-accent-solid/5">
        <h2 id="product-tips-title" className="mb-sm flex items-center gap-2 text-title text-fg">
          <span className="text-accent"><LightbulbIcon size={22} /></span>
          {title}
        </h2>
        <ul className="flex flex-col gap-sm">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-label leading-relaxed text-fg-secondary">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent text-accent"><CheckIcon size={12} /></span>
              {tip}
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}
