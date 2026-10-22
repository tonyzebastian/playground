'use client'
import { useEffect, useState } from "react";
import { motion } from "motion/react";

// The fanned-out layout spans about 640px. Scale it down on narrower viewports
// (phones, the home split panel) rather than hiding the side images.
const FULL_WIDTH = 640;

export default function ImageReveal({ leftImage, middleImage, rightImage }) {
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const update = () => setScale(Math.min(1, window.innerWidth / FULL_WIDTH));
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const containerVariants = {
        initial: {
            opacity: 0,
        },
        animate: {
            opacity: 1,
            transition: {
                delay: 0.2,
                staggerChildren: 0.15,
            }
        }
    };

    const leftImageVariants = {
        initial: { rotate: 0, x: 0, y: 0 },
        animate: {
            rotate: -8,
            x: -150,
            y: 10,
            transition: {
                type: "spring",
                stiffness: 120,
                damping: 12
            }
        },
        hover: {
            rotate: 1,
            x: -160,
            y: 0,
            transition: {
                type: "spring",
                stiffness: 200,
                damping: 15
            }
        }
    };

    const middleImageVariants = {
        initial: { rotate: 0, x: 0, y: 0 },
        animate: {
            rotate: 6,
            x: 0,
            y: 0,
            transition: {
                type: "spring",
                stiffness: 120,
                damping: 12
            }
        },
        hover: {
            rotate: 0,
            x: 0,
            y: -10,
            transition: {
                type: "spring",
                stiffness: 200,
                damping: 15
            }
        }
    };

    const rightImageVariants = {
        initial: { rotate: 0, x: 0, y: 0 },
        animate: {
            rotate: -6,
            x: 200,
            y: 20,
            transition: {
                type: "spring",
                stiffness: 120,
                damping: 12
            }
        },
        hover: {
            rotate: 3,
            x: 200,
            y: 10,
            transition: {
                type: "spring",
                stiffness: 200,
                damping: 15
            }
        }
    };

    return (
        <div style={{ transform: `scale(${scale})` }}>
        <motion.div 
            className="relative flex items-center justify-center w-64 h-64 my-12 "
            variants={containerVariants}
            initial="initial"
            animate="animate"
        >
            {/* Left Image - Lowest z-index */}
            <motion.div
                className="absolute w-48 h-48 origin-bottom-right overflow-hidden rounded-xl shadow-lg bg-white"
                variants={leftImageVariants}
                whileHover="hover"
                animate="animate"
                style={{ zIndex: 10 }}
            >
                <img
                    src={leftImage}
                    alt="Left image"
                    className="w-full h-full object-cover p-2 rounded-xl"
                />
            </motion.div>

            {/* Middle Image - Middle z-index */}
            <motion.div
                className="absolute w-48 h-48 origin-bottom-left overflow-hidden rounded-xl shadow-lg bg-white"
                variants={middleImageVariants}
                whileHover="hover"
                animate="animate"
                style={{ zIndex: 20 }}
            >
                <img
                    src={middleImage}
                    alt="Middle image"
                    className="w-full h-full object-cover p-2 rounded-2xl"
                />
            </motion.div>

            {/* Right Image - Highest z-index */}
            <motion.div
                className="absolute w-48 h-48 origin-bottom-right overflow-hidden rounded-xl shadow-lg bg-white"
                variants={rightImageVariants}
                whileHover="hover"
                animate="animate"
                style={{ zIndex: 30 }}
            >
                <img
                    src={rightImage}
                    alt="Right image"
                    className="w-full h-full object-cover p-2 rounded-2xl"
                />
            </motion.div>
        </motion.div>
        </div>
    );
}