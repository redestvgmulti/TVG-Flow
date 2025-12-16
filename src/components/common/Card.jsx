import React from 'react';
// import './Card.css';

export const Card = ({
    children,
    className = '',
    glass = false,
    hover = false,
    onClick,
    ...props
}) => {
    const baseClass = 'card';
    const glassClass = glass ? 'glass' : '';
    const hoverClass = hover ? 'card-hover' : '';
    const clickableClass = onClick ? 'card-clickable' : '';
    const classes = `${baseClass} ${glassClass} ${hoverClass} ${clickableClass} ${className}`.trim();

    return (
        <div className={classes} onClick={onClick} {...props}>
            {children}
        </div>
    );
};
