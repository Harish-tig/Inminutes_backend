const { User } = require("../models/models");
const validator = require("../validators/validators");
const { isValidObjectId, reserveStock, releaseStock } = require("../utils/utils");

// Personal cart for normal (non-group) ordering. Stock is reserved as soon as
// an item is added/increased, and released as soon as it is decreased/removed,
// so availability reflects what's actually still purchasable at any moment.

const getCartfn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const user = await User.findById(userId).populate("cart.product");

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        res.status(200).json({ data: user.cart });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to fetch cart" });
    }
};

const addToCartfn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const result = validator.addCartItemValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { productId, qty } = result.data;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        const alreadyInCart = user.cart.some((item) => item.product.toString() === productId);

        if (alreadyInCart) {
            return res.status(409).json({ mssg: "Product already in cart, use PATCH to update quantity" });
        }

        const product = await reserveStock(productId, qty);

        if (!product) {
            return res.status(409).json({ mssg: "Insufficient stock" });
        }

        user.cart.push({ product: productId, qty });
        await user.save();

        res.status(201).json({ data: user.cart });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to add product to cart" });
    }
};

const updateCartItemfn = async (req, res) => {
    try {
        const { userId, productId } = req.params;

        if (!isValidObjectId(userId) || !isValidObjectId(productId)) {
            return res.status(400).json({ mssg: "Invalid id" });
        }

        const result = validator.updateCartItemValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { qty } = result.data;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        const item = user.cart.find((item) => item.product.toString() === productId);

        if (!item) {
            return res.status(404).json({ mssg: "Product not in cart" });
        }

        const delta = qty - item.qty;

        if (delta > 0) {
            const product = await reserveStock(productId, delta);
            if (!product) {
                return res.status(409).json({ mssg: "Insufficient stock" });
            }
        } else if (delta < 0) {
            await releaseStock(productId, -delta);
        }

        item.qty = qty;
        await user.save();

        res.status(200).json({ data: item });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to update cart item" });
    }
};

const removeCartItemfn = async (req, res) => {
    try {
        const { userId, productId } = req.params;

        if (!isValidObjectId(userId) || !isValidObjectId(productId)) {
            return res.status(400).json({ mssg: "Invalid id" });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        const item = user.cart.find((item) => item.product.toString() === productId);

        if (!item) {
            return res.status(404).json({ mssg: "Product not in cart" });
        }

        await releaseStock(productId, item.qty);

        user.cart = user.cart.filter((item) => item.product.toString() !== productId);
        await user.save();

        res.status(200).json({ data: user.cart });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to remove cart item" });
    }
};

module.exports = {
    getCartfn,
    addToCartfn,
    updateCartItemfn,
    removeCartItemfn
};
