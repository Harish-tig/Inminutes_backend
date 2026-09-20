const model = require("../models/models")
const validator = require('../validators/validators')
const { isValidObjectId } = require('../utils/utils')

const getProductsfn = async (req, res) => {
    try {
            const products = await model.Product.find();

            res.status(200).json({
                data: products
            });

        } catch (error) {
            res.status(500).json({
                mssg: "Failed to fetch products"
            });
        }

};

const getProductByIdfn = async (req, res) => {
    try {
        const { productId } = req.params;

        if (!isValidObjectId(productId)) {
            return res.status(400).json({ mssg: "Invalid product id" });
        }

        const product = await model.Product.findById(productId);

        if (!product) {
            return res.status(404).json({ mssg: "Product not found" });
        }

        res.status(200).json({ data: product });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to fetch product" });
    }
};

module.exports = {
    getProductsfn,
    getProductByIdfn
}
