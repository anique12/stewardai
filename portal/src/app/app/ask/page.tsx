import { AskPanel } from "@/components/ask/AskPanel";

export default function AskPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Ask Steward</h1>
        <p className="text-sm text-gray-500">
          Ask anything about your meetings and work. Answers cite the meetings they come from.
        </p>
      </div>
      <AskPanel />
    </div>
  );
}
