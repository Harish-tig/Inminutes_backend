const { User } = require("../models/models")
const validator = require('../validators/validators')
const { isValidObjectId } = require('../utils/utils')

const createUserFn = async (req, res) => {

    try {
        const result = validator.UserSchemaValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                errors: result.error.issues
            });
        }

        const data = result.data;

        var user = await User.create({
            username: data.username
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                error: "Username already exists"
            });
        }

        return res.status(500).json({
            error: "Internal server error"
        });
    }

    res.status(201).json({
        id: user.id,
        name: user.username
    })
};

const getUserfn = async (req, res) => {
    try {
        const result = await User.find()
        res.status(200).json({
            data: result
        })
    }
    catch (error) {
        res.status(500).json({
            mssg: "Failed to fetch user"
        });
    }
}

const getUserByIdFn = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ mssg: "User not found" });
        }

        res.status(200).json({ data: user });
    } catch (error) {
        res.status(500).json({ mssg: "Failed to fetch user" });
    }
}



module.exports = {
    createUserFn,
    getUserfn,
    getUserByIdFn
}
