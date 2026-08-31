from verein.donation_management.indexes import ensure_donation_management_indexes


def execute() -> None:
	ensure_donation_management_indexes()
