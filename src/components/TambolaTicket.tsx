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
      className="rounded-xl sm:rounded-2xl p-2 sm:p-4 shadow-2xl"
      style={{
        background: "linear-gradient(135deg, var(--tambola-gold), oklch(0.78 0.16 60))",
      }}
    >
      <div className="flex items-center justify-between mb-2 sm:mb-3 px-1">
        <span className="font-serif text-sm sm:text-lg font-bold text-[oklch(0.18_0.04_290)] truncate">
          🎟️ {playerName}
        </span>
        <span className="text-[9px] sm:text-xs font-semibold text-[oklch(0.18_0.04_290)]/70 shrink-0 ml-2">
          TAMBOLA TICKET
        </span>
      </div>
      <div
        className="grid gap-0.5 sm:gap-1 p-1.5 sm:p-2 rounded-md sm:rounded-lg"
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
