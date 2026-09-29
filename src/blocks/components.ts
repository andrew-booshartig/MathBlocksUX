/** Block type → the component that draws it. Typed as a complete record
 * over every block type, so a type without a component (or a component
 * for a type that doesn't exist) is a compile error, not a blank node. */
import type { ComponentType } from "react";
import type { NodeProps } from "@xyflow/react";
import type { BlockType } from "./meta";
import VariableBlockNode from "./VariableBlockNode";
import SimplifyBlockNode from "./SimplifyBlockNode";
import GraphBlockNode from "./GraphBlockNode";
import SolveBlockNode from "./SolveBlockNode";
import CustomBlockNode from "./CustomBlockNode";
import SliderBlockNode from "./SliderBlockNode";
import IncrementBlockNode from "./IncrementBlockNode";
import NoteBlockNode from "./NoteBlockNode";
import TableBlockNode from "./TableBlockNode";
import LineBlockNode from "./LineBlockNode";
import QuadraticBlockNode from "./QuadraticBlockNode";
import SequenceBlockNode from "./SequenceBlockNode";
import StatsBlockNode from "./StatsBlockNode";
import PracticeBlockNode from "./PracticeBlockNode";
import BalanceBlockNode from "./BalanceBlockNode";
import WorkBlockNode from "./WorkBlockNode";
import CalculatorBlockNode from "./CalculatorBlockNode";
import { withBoundary } from "./BlockErrorBoundary";

const RAW: Record<BlockType, ComponentType<NodeProps>> = {
  variable: VariableBlockNode,
  slider: SliderBlockNode,
  increment: IncrementBlockNode,
  simplify: SimplifyBlockNode,
  solve: SolveBlockNode,
  work: WorkBlockNode,
  balance: BalanceBlockNode,
  calculator: CalculatorBlockNode,
  graph: GraphBlockNode,
  table: TableBlockNode,
  line: LineBlockNode,
  quadratic: QuadraticBlockNode,
  sequence: SequenceBlockNode,
  stats: StatsBlockNode,
  practice: PracticeBlockNode,
  note: NoteBlockNode,
  custom: CustomBlockNode,
};

/** Every block wrapped so a crash stays inside that block. */
export const BLOCK_COMPONENTS = Object.fromEntries(
  Object.entries(RAW).map(([type, component]) => [type, withBoundary(component)]),
) as Record<BlockType, ComponentType<NodeProps>>;
