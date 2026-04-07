import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { VectorDatabase } from "../src/database";

describe("VectorDatabase", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = path.join(os.tmpdir(), `vdb-test-${Date.now()}.json`);
    });

    afterEach(() => {
        try {
            fs.unlinkSync(tmp);
        } catch {
        }
    });

    it("add + query ranks by relevance", () => {
        const db = VectorDatabase.openOrCreate(tmp, "tfidf");
        db.add("machine learning on large datasets");
        db.add("cooking pasta with tomato sauce");
        db.add("neural networks and gradient descent");
        db.save(tmp);

        const db2 = VectorDatabase.load(tmp);
        const r = db2.search("machine learning neural", 2, { exact: true });
        expect(r.length).toBe(2);
        const top = r[0].text;
        expect(top.includes("learning") || top.includes("neural")).toBe(true);
    });

    it("persists across load", () => {
        const db = VectorDatabase.openOrCreate(tmp, "tfidf");
        db.add("hello world");
        db.save(tmp);
        const db2 = VectorDatabase.load(tmp);
        expect(db2.size).toBe(1);
    });
});
