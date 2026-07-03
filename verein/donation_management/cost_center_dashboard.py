from __future__ import annotations

from calendar import month_name
from datetime import date
from typing import Any

import frappe
from frappe import _
from frappe.utils import add_months, flt, get_first_day, get_last_day, getdate, today

from verein.donation_management.permissions import (
	can_manage_all_budgets,
	can_view_all_cost_centers,
	get_descendant_cost_centers,
	has_cost_center_access,
)


@frappe.whitelist()
def get_accessible_cost_centers() -> list[dict[str, Any]]:
	user = frappe.session.user
	if can_view_all_cost_centers(user):
		rows = frappe.get_all(
			"Cost Center",
			filters={"disabled": 0},
			fields=["name", "cost_center_name", "company", "is_group"],
			order_by="company asc, lft asc",
		)
		for row in rows:
			row["can_manage_budget"] = can_manage_all_budgets(user)
		return rows

	access_rows = frappe.get_all(
		"Cost Center Access",
		filters={"user": user, "active": 1},
		fields=["cost_center", "access_level"],
		order_by="modified desc",
	)
	if not access_rows:
		return []

	access_by_cost_center = {row.cost_center: row.access_level for row in access_rows}
	rows = frappe.get_all(
		"Cost Center",
		filters={"name": ["in", list(access_by_cost_center)], "disabled": 0},
		fields=["name", "cost_center_name", "company", "is_group"],
		order_by="company asc, lft asc",
	)
	for row in rows:
		row["can_manage_budget"] = access_by_cost_center.get(row.name) == "Manage"

	return rows


@frappe.whitelist()
def get_dashboard_data(
	cost_center: str,
	from_date: str | date | None = None,
	to_date: str | date | None = None,
) -> dict[str, Any]:
	if not has_cost_center_access(cost_center):
		frappe.throw(_("You are not allowed to access this cost center."))

	from_date, to_date = normalize_period(from_date, to_date)
	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		frappe.throw(_("Cost Center {0} was not found.").format(cost_center))

	months = make_month_rows(from_date, to_date)
	month_map = {row["month"]: row for row in months}

	for row in get_gl_rows(cost_centers, from_date, to_date):
		month_row = month_map.get(row.month)
		if not month_row:
			continue
		month_row["income"] = flt(row.income)
		month_row["expense"] = flt(row.expense)
		month_row["net"] = flt(row.income) - flt(row.expense)

	for row in get_budget_rows(cost_centers, months):
		month_row = month_map.get(row["month"])
		if not month_row:
			continue
		month_row["budget"] = flt(row["budget"])

	summary = {
		"income": sum(flt(row["income"]) for row in months),
		"expense": sum(flt(row["expense"]) for row in months),
		"net": sum(flt(row["net"]) for row in months),
		"budget": sum(flt(row["budget"]) for row in months),
	}

	return {
		"cost_center": cost_center,
		"from_date": from_date.isoformat(),
		"to_date": to_date.isoformat(),
		"can_manage_budget": has_cost_center_access(cost_center, access_level="Manage"),
		"summary": summary,
		"months": months,
	}


@frappe.whitelist()
def get_cost_center_balance(cost_center: str) -> float:
	if not has_cost_center_access(cost_center):
		frappe.throw(_("You are not allowed to access this cost center."))

	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		frappe.throw(_("Cost Center {0} was not found.").format(cost_center))

	return calculate_cost_center_balance(cost_centers)


def calculate_cost_center_balance(cost_centers: list[str], posting_date: str | date | None = None) -> float:
	if not cost_centers:
		return 0.0

	posting_date = getdate(posting_date) if posting_date else getdate(today())
	row = frappe.db.sql(
		"""
		select
			sum(`tabGL Entry`.`credit` - `tabGL Entry`.`debit`) as balance
		from `tabGL Entry`
		inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
		where
			`tabGL Entry`.`is_cancelled` = 0
			and `tabGL Entry`.`cost_center` in %(cost_centers)s
			and `tabGL Entry`.`posting_date` <= %(posting_date)s
			and `tabAccount`.`root_type` in ('Income', 'Expense')
		""",
		{"cost_centers": tuple(cost_centers), "posting_date": posting_date},
		as_dict=True,
	)
	return flt(row[0].balance if row else 0)


@frappe.whitelist()
def upsert_budget(cost_center: str, from_date: str | date, budget_amount: float | str):
	if not has_cost_center_access(cost_center, access_level="Manage"):
		frappe.throw(_("You are not allowed to manage budgets for this cost center."))

	normalized_from_date = get_first_day(getdate(from_date))
	amount = flt(budget_amount)

	existing = frappe.db.get_value(
		"Cost Center Budget",
		{"cost_center": cost_center, "from_date": normalized_from_date},
		"name",
	)
	if existing:
		doc = frappe.get_doc("Cost Center Budget", existing)
		doc.budget_amount = amount
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Cost Center Budget",
				"cost_center": cost_center,
				"from_date": normalized_from_date,
				"budget_amount": amount,
			}
		)

	doc.flags.ignore_permissions = True
	doc.save()
	return {
		"name": doc.name,
		"from_date": getdate(doc.from_date).isoformat(),
		"budget_amount": flt(doc.budget_amount),
	}


def normalize_period(
	from_date: str | date | None = None,
	to_date: str | date | None = None,
) -> tuple[date, date]:
	if from_date:
		from_date = getdate(from_date)
	else:
		from_date = add_months(get_first_day(today()), -11)

	if to_date:
		to_date = getdate(to_date)
	else:
		to_date = get_last_day(today())

	if from_date > to_date:
		frappe.throw(_("From Date cannot be after To Date."))

	return from_date, to_date


def make_month_rows(from_date: date, to_date: date) -> list[dict[str, Any]]:
	rows = []
	cursor = get_first_day(from_date)
	last_month = get_first_day(to_date)
	while cursor <= last_month:
		month_key = f"{cursor.year}-{cursor.month:02d}"
		rows.append(
			{
				"month": month_key,
				"label": f"{month_name[cursor.month]} {cursor.year}",
				"month_start": cursor.isoformat(),
				"year": cursor.year,
				"month_number": f"{cursor.month:02d}",
				"income": 0.0,
				"expense": 0.0,
				"net": 0.0,
				"budget": 0.0,
			}
		)
		cursor = add_months(cursor, 1)
	return rows


def get_gl_rows(cost_centers: list[str], from_date: date, to_date: date):
	if not cost_centers:
		return []

	return frappe.db.sql(
		"""
		select
			date_format(`tabGL Entry`.`posting_date`, '%%Y-%%m') as month,
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
		group by date_format(`tabGL Entry`.`posting_date`, '%%Y-%%m')
		""",
		{"cost_centers": tuple(cost_centers), "from_date": from_date, "to_date": to_date},
		as_dict=True,
	)


def get_budget_rows(cost_centers: list[str], months: list[dict[str, Any]]):
	if not cost_centers or not months:
		return []

	budget_entries = frappe.db.sql(
		"""
		select
			`cost_center`,
			`from_date`,
			`budget_amount`
		from `tabCost Center Budget`
		where
			`cost_center` in %(cost_centers)s
			and `from_date` <= %(to_month_start)s
		order by `cost_center` asc, `from_date` asc
		""",
		{
			"cost_centers": tuple(cost_centers),
			"to_month_start": months[-1]["month_start"],
		},
		as_dict=True,
	)

	budgets_by_cost_center: dict[str, list[Any]] = {}
	for entry in budget_entries:
		budgets_by_cost_center.setdefault(entry.cost_center, []).append(entry)

	rows = []
	for month in months:
		month_start = getdate(month["month_start"])
		budget = 0.0
		for entries in budgets_by_cost_center.values():
			current_budget = 0.0
			for entry in entries:
				if getdate(entry.from_date) > month_start:
					break
				current_budget = flt(entry.budget_amount)
			budget += current_budget
		rows.append({"month": month["month"], "budget": budget})

	return rows
