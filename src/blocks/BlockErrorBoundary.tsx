/** If one block crashes, only that block shows an error — the rest of the
 * canvas keeps working (without this, any block error blanks the app).
 * Matters more as community blocks arrive: nobody else's bug should take
 * down your lesson. */
import { Component, type ComponentType, type ReactNode } from "react";
import type { NodeProps } from "@xyflow/react";
import { useStore } from "../store";

class Boundary extends Component<{ id: string; children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`block ${this.props.id} crashed`, error);
  }

  render() {
    if (!this.state.error) return <Boundary.Keyed key={this.state.attempt}>{this.props.children}</Boundary.Keyed>;
    const type = useStore.getState().blocks[this.props.id]?.type ?? "block";
    return (
      <div className="block-shell block-crashed">
        <div className="block-shell-header">
          <span>{type} — hit a problem</span>
        </div>
        <div className="block-shell-body">
          <div className="block-error">{this.state.error.message}</div>
          <div className="block-row">
            <button className="action-btn is-primary nodrag" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
              ↻ Reload block
            </button>
            <button className="action-btn nodrag" onClick={() => useStore.getState().removeBlock(this.props.id)}>
              Remove it
            </button>
          </div>
        </div>
      </div>
    );
  }

  static Keyed({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
}

export function withBoundary(Block: ComponentType<NodeProps>): ComponentType<NodeProps> {
  function Guarded(props: NodeProps) {
    return (
      <Boundary id={props.id}>
        <Block {...props} />
      </Boundary>
    );
  }
  Guarded.displayName = `Guarded(${Block.displayName ?? Block.name})`;
  return Guarded;
}
