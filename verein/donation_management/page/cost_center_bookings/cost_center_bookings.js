/* global verein */
frappe.provide("verein.donation_management");

// Keep the adapter self-contained: the shared runtime lives in the lazy bundle.
(() => {
	const module = verein.donation_management;
	const refresh = (wrapper) => {
		if (!module.assetsReady) {
			module.assetsReady = frappe
				.require(["donation_management.bundle.js", "donation_management.bundle.css"])
				.then(() => {
					const hasStyles = [...document.styleSheets].some((sheet) =>
						sheet.href?.includes("/donation_management.bundle.")
					);
					if (!module.refresh_page || !hasStyles) {
						frappe.msgprint(
							__("Donation Management could not be loaded. Please reload the page.")
						);
						return false;
					}
					return true;
				});
		}
		return module.assetsReady.then(
			(ready) => ready && module.refresh_page("cost-center-bookings", wrapper)
		);
	};
	frappe.pages["cost-center-bookings"].on_page_load = refresh;
	frappe.pages["cost-center-bookings"].refresh = refresh;
})();
