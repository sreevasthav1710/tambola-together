import type { Ticket } from "@/lib/tambola";

interface Props {
  ticket: Ticket;
  marked: Set<number>;
  called: Set<number>;
  onCellClick: (n: number) => void;
  playerName: string;
}

export function TambolaTicket({ ticket, marked, called, onCellClick, playerName }: Props) {
  return (
    <div
      className="rounded-2xl p-4 shadow-2xl"
      style={{
        background: "linear-gradient(135deg, var(--tambola-gold), oklch(0.78 0.16 60))",
      }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="font-serif text-lg font-bold text-[oklch(0.18_0.04_290)]">
          🎟️ {playerName}
        </span>
        <span className="text-xs font-semibold text-[oklch(0.18_0.04_290)]/70">
          TAMBOLA TICKET
        </span>
      </div>
      <div
        className="grid gap-1 p-2 rounded-lg"
        style={{
          gridTemplateColumns: "repeat(9, minmax(0, 1fr))",
          background: "oklch(0.18 0.04 290 / 0.85)",
        }}
      >
        {ticket.flatMap((row, r) =>
          row.map((cell, c) => {
            const key = `${r}-${c}`;
            if (cell === null) {
              return <div key={key} className="ticket-cell ticket-cell-empty rounded-sm" />;
            }
            const isMarked = marked.has(cell);
            const isCalled = called.has(cell);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onCellClick(cell)}
                className={`ticket-cell rounded-sm ${isMarked ? "ticket-cell-marked" : "ticket-cell-num"}`}
                title={isCalled ? "Called" : "Not called yet"}
              >
                {cell}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
