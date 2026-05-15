import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";
import TableSortItems from "@/components/common/table/table-sort-items";

interface TableHeaderItemProps {
  label?: string;
  field?: string;
  colSpan?: number;
  defaultSelected?: boolean;
  className?: string;
  children?: ReactNode;
}

const HEADER_CELL_CLASSES =
  "border-x-2 border-transparent bg-clip-padding bg-table_row text-center shadow-[0_4px_4px_rgba(0,0,0,0.8)]";

const TableHeaderItem: FC<TableHeaderItemProps> = ({
  label,
  field,
  colSpan = 1,
  defaultSelected = false,
  className,
  children,
}) => {
  return (
    <th colSpan={colSpan} className={cn(HEADER_CELL_CLASSES, className)}>
      {children ?? (
        <TableSortItems
          label={label ?? ""}
          field={field}
          defaultSelected={defaultSelected}
        />
      )}
    </th>
  );
};

export default TableHeaderItem;
