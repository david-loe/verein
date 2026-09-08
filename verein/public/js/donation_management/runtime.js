// Frappe calls page events synchronously, even when their handlers return promises.
export function create_page_runtime(pages) {
	const instances = new Map();
	let observer;

	function watch_removal() {
		if (observer) return;
		observer = new MutationObserver(() => {
			for (const [wrapper, record] of instances) {
				if (!wrapper.isConnected) {
					record.page.destroy();
					instances.delete(wrapper);
				}
			}
			if (!instances.size) {
				observer.disconnect();
				observer = null;
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	return function refresh_page(name, wrapper) {
		if (!wrapper.isConnected) return Promise.resolve();
		let record = instances.get(wrapper);
		if (!record) {
			const { Page, property } = pages[name];
			const page = new Page(wrapper);
			wrapper[property] = page;
			record = { page, pending: null };
			instances.set(wrapper, record);
			watch_removal();
		}
		if (!record.pending) {
			record.pending = Promise.resolve()
				.then(() => record.page.refresh())
				.catch((error) => {
					if (!record.page.destroyed) {
						frappe.msgprint(error.message || __("Data could not be loaded."));
					}
				})
				.finally(() => {
					record.pending = null;
				});
		}
		return record.pending;
	};
}
