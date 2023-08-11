/*
 * MywaJS 2023
 * re-developed wwebjs
 * using with playwright & wajs
 * contact:
 * wa: 085157489446
 * ig: amirul.dev
 */

import Base from './Base.js'

class ProductMetadata extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /** Product ID */
        this.id = data.id;
        /** Retailer ID */
        this.retailer_id = data.retailer_id;
        /** Product Name  */
        this.name = data.name;
        /** Product Description */
        this.description = data.description;

        return super._patch(data);
    }

}

export default ProductMetadata;