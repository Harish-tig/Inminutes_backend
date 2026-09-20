const { User, Order } = require("../models/models");
const { isValidObjectId } = require("../utils/utils");

// Stock for cart items was already reserved when they were added, so placing
// the order just snapshots the cart into an Order and empties it — no
// Product.qty change happens here.

const placeOrderfn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const user = await User.findById(userId).populate("cart.product");

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        if (user.cart.length === 0) {
            return res.status(400).json({ mssg: "Cart is empty" });
        }

        const products = user.cart.map((item) => ({
            product: item.product._id,
            name: item.product.name,
            price: item.product.price,
            qty: item.qty
        }));

        const order_amt = products.reduce((sum, p) => sum + p.price * p.qty, 0);

        const order = await Order.create({
            order_date: new Date(),
            order_amt,
            order_status: "placed",
            order_type: "normal",
            order_by_user: userId,
            products
        });

        user.order_placed.push(order._id);
        user.cart = [];
        await user.save();

        res.status(201).json({ data: order });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to place order" });
    }
};

const getOrdersfn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const user = await User.findById(userId).populate({
            path: "order_placed",
            options: { sort: { order_date: -1 } }
        });

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        res.status(200).json({ data: user.order_placed });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to fetch orders" });
    }
};

// --- Host-only group order log -----------------------------------------------

// A populated ref is a User document; an unpopulated one is the id itself.
const refId = (ref) => (ref?._id ? ref._id.toString() : ref?.toString() || null);

// Per-person totals for one group order: who ordered what, and what it came to.
// Every known member is seeded first so someone who ordered nothing still shows
// up in the log with a zero line instead of silently disappearing.
const buildBreakdown = (order) => {
    const rows = new Map();

    const seed = (ref, display_name) => {
        const id = refId(ref);

        if (id && !rows.has(id)) {
            rows.set(id, {
                user: ref,
                display_name: display_name || ref?.username || null,
                lines: 0,
                qty: 0,
                amount: 0
            });
        }

        return id;
    };

    seed(order.grp_order?.host, order.grp_order?.host_display_name);
    (order.grp_order?.members || []).forEach((m) => seed(m.user, m.display_name));

    // Group orders placed before lines recorded who added them collect here.
    let unattributed = null;

    for (const line of order.products) {
        const amount = line.price * line.qty;
        const id = seed(line.added_by, line.added_by_name);

        if (!id) {
            unattributed = unattributed || {
                user: null,
                display_name: null,
                lines: 0,
                qty: 0,
                amount: 0
            };
            unattributed.lines += 1;
            unattributed.qty += line.qty;
            unattributed.amount += amount;
            continue;
        }

        const row = rows.get(id);
        row.lines += 1;
        row.qty += line.qty;
        row.amount += amount;
    }

    const breakdown = [...rows.values()];

    if (unattributed) {
        breakdown.push(unattributed);
    }

    return breakdown;
};

const shapeGroupOrder = (order) => ({
    _id: order._id,
    order_date: order.order_date,
    order_amt: order.order_amt,
    order_status: order.order_status,
    join_code: order.grp_order?.join_code || null,
    host: {
        user: order.grp_order?.host || null,
        display_name: order.grp_order?.host_display_name || order.grp_order?.host?.username || null
    },
    members: (order.grp_order?.members || []).map((m) => ({
        user: m.user,
        display_name: m.display_name || m.user?.username || null
    })),
    products: order.products.map((line) => ({
        product: line.product,
        name: line.name,
        price: line.price,
        qty: line.qty,
        line_amt: line.price * line.qty,
        added_by: line.added_by || null,
        added_by_name: line.added_by_name || line.added_by?.username || null
    })),
    breakdown: buildBreakdown(order)
});

// Every group order this user hosted, newest first.
//
// "Host only" is the query itself: an order is only ever returned to the user
// recorded as its host, so a participant asking for their own log gets back the
// sessions they ran, never the ones they merely joined. Those still show up in
// their normal order history via GET /users/:userId/orders.
const getHostedGroupOrdersfn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const user = await User.findById(userId).select("_id");

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        const orders = await Order.find({
            order_type: "group",
            "grp_order.host": userId
        })
            .sort({ order_date: -1 })
            .populate("grp_order.host", "username")
            .populate("grp_order.members.user", "username")
            .populate("products.added_by", "username");

        res.status(200).json({ data: orders.map(shapeGroupOrder) });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to fetch hosted group orders" });
    }
};

module.exports = {
    placeOrderfn,
    getOrdersfn,
    getHostedGroupOrdersfn
};
