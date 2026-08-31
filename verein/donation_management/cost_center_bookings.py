from __future__ import annotations

from datetime import date
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt

from verein.donation_management.cost_center_dashboard import normalize_period
from verein.donation_management.permissions import get_descendant_cost_centers, has_cost_center_access

DEFAULT_PAGE_LENGTH = 200
MAX_PAGE_LENGTH = 500


@frappe.whitelist()
def get_booking_entries(
	cost_center: str,
	from_date: str | date | None = None,
	to_date: str | date | None = None,
	limit_start: int | str = 0,
	limit: int | str = DEFAULT_PAGE_LENGTH,
	order_by: str | None = "posting_date",
	order_direction: str | None = "desc",
) -> dict[str, Any]:
	if not has_cost_center_access(cost_center):
		frappe.throw(_("You are not allowed to access this cost center."))

	from_date, to_date = normalize_period(from_date, to_date)
	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		frappe.throw(_("Cost Center {0} was not found.").format(cost_center))

	limit_start = max(int(limit_start or 0), 0)
	limit = min(max(int(limit or DEFAULT_PAGE_LENGTH), 1), MAX_PAGE_LENGTH)
	order_clause = get_order_clause(order_by, order_direction)

	rows, summary = get_booking_rows_and_summary(
		cost_centers, from_date, to_date, limit_start, limit + 1, order_clause
	)
	has_more = len(rows) > limit
	rows = rows[:limit]

	return {
		"cost_center": cost_center,
		"from_date": from_date.isoformat(),
		"to_date": to_date.isoformat(),
		"limit_start": limit_start,
		"limit": limit,
		"has_more": has_more,
		"next_limit_start": limit_start + len(rows),
		"summary": summary,
		"entries": rows,
	}


def get_booking_rows_and_summary(
	cost_centers: list[str],
	from_date: date,
	to_date: date,
	limit_start: int,
	limit: int,
	order_clause: str,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
	if not cost_centers:
		return [], empty_booking_summary()

	rows = frappe.db.sql(
		f"""
		with booking_rows as (
			select
				`tabGL Entry`.`name`,
				`tabGL Entry`.`posting_date`,
				`tabGL Entry`.`creation`,
				`tabGL Entry`.`cost_center`,
				`tabGL Entry`.`account`,
				`tabAccount`.`account_name`,
				`tabAccount`.`root_type`,
				`tabGL Entry`.`voucher_type`,
				`tabGL Entry`.`voucher_no`,
				`tabGL Entry`.`remarks`,
				`tabGL Entry`.`debit`,
				`tabGL Entry`.`credit`,
				case when `tabAccount`.`root_type` = 'Income'
					then `tabGL Entry`.`credit` - `tabGL Entry`.`debit`
					else 0
				end as income,
				case when `tabAccount`.`root_type` = 'Expense'
					then `tabGL Entry`.`debit` - `tabGL Entry`.`credit`
					else 0
				end as expense,
				`tabGL Entry`.`credit` - `tabGL Entry`.`debit` as net
			from `tabGL Entry`
			inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
			where
				`tabGL Entry`.`is_cancelled` = 0
				and `tabGL Entry`.`cost_center` in %(cost_centers)s
				and `tabGL Entry`.`posting_date` between %(from_date)s and %(to_date)s
				and `tabAccount`.`root_type` in ('Income', 'Expense')
		), booking_rows_with_summary as (
			select
				*,
				sum(income) over () as summary_income,
				sum(expense) over () as summary_expense
			from booking_rows
		)
		select
			`booking_rows_with_summary`.`name`,
			`booking_rows_with_summary`.`posting_date`,
			`booking_rows_with_summary`.`cost_center`,
			`tabCost Center`.`cost_center_name`,
			`booking_rows_with_summary`.`account`,
			`booking_rows_with_summary`.`account_name`,
			`booking_rows_with_summary`.`root_type`,
			`booking_rows_with_summary`.`voucher_type`,
			`booking_rows_with_summary`.`voucher_no`,
			`booking_rows_with_summary`.`remarks`,
			`booking_rows_with_summary`.`debit`,
			`booking_rows_with_summary`.`credit`,
			`booking_rows_with_summary`.`income`,
			`booking_rows_with_summary`.`expense`,
			`booking_rows_with_summary`.`net`,
			`booking_rows_with_summary`.`summary_income`,
			`booking_rows_with_summary`.`summary_expense`
		from booking_rows_with_summary
		left join `tabCost Center`
			on `tabCost Center`.`name` = `booking_rows_with_summary`.`cost_center`
		order by {order_clause}
		limit %(limit)s offset %(limit_start)s
		""",
		{
			"cost_centers": tuple(cost_centers),
			"from_date": from_date,
			"to_date": to_date,
			"limit": limit,
			"limit_start": limit_start,
		},
		as_dict=True,
	)

	summary = get_summary_from_booking_rows(rows)
	if not rows and limit_start:
		summary = get_booking_summary(cost_centers, from_date, to_date)
	for row in rows:
		row["income"] = flt(row.income)
		row["expense"] = flt(row.expense)
		row["net"] = flt(row.net)
		row.pop("summary_income", None)
		row.pop("summary_expense", None)

	return rows, summary


def get_summary_from_booking_rows(rows: list[dict[str, Any]]) -> dict[str, float]:
	if not rows:
		return empty_booking_summary()
	income = flt(rows[0].summary_income)
	expense = flt(rows[0].summary_expense)
	return {"income": income, "expense": expense, "net": income - expense}


def empty_booking_summary() -> dict[str, float]:
	return {"income": 0.0, "expense": 0.0, "net": 0.0}


def get_order_clause(order_by: str | None, order_direction: str | None) -> str:
	order_columns = {
		"posting_date": "`booking_rows_with_summary`.`posting_date`",
		"account": "coalesce(`booking_rows_with_summary`.`account_name`, `booking_rows_with_summary`.`account`)",
		"remarks": "coalesce(`booking_rows_with_summary`.`remarks`, '')",
		"net": "`booking_rows_with_summary`.`net`",
	}
	if order_by not in order_columns:
		order_by = "posting_date"
		order_direction = "desc"
	column = order_columns[order_by]
	direction = "asc" if (order_direction or "").lower() == "asc" else "desc"
	tiebreaker_direction = direction if order_by in {"posting_date", "net"} else "asc"
	return (
		f"{column} {direction}, "
		f"`booking_rows_with_summary`.`posting_date` {tiebreaker_direction}, "
		"`booking_rows_with_summary`.`creation` desc, "
		"`booking_rows_with_summary`.`name` desc"
	)


def get_booking_summary(cost_centers: list[str], from_date: date, to_date: date) -> dict[str, float]:
	if not cost_centers:
		return empty_booking_summary()

	row = frappe.db.sql(
		"""
		select
			sum(
				case when `tabAccount`.`root_type` = 'Income'
				then `tabGL Entry`.`credit` - `tabGL Entry`.`debit`
				else 0 end
			) as income,
			sum(
				case when `tabAccount`.`root_type` = 'Expense'
				then `tabGL Entry`.`debit` - `tabGL Entry`.`credit`
				else 0 end
			) as expense
		from `tabGL Entry`
		inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
		where
			`tabGL Entry`.`is_cancelled` = 0
			and `tabGL Entry`.`cost_center` in %(cost_centers)s
			and `tabGL Entry`.`posting_date` between %(from_date)s and %(to_date)s
			and `tabAccount`.`root_type` in ('Income', 'Expense')
		""",
		{"cost_centers": tuple(cost_centers), "from_date": from_date, "to_date": to_date},
		as_dict=True,
	)[0]

	income = flt(row.income)
	expense = flt(row.expense)
	return {
		"income": income,
		"expense": expense,
		"net": income - expense,
	}
